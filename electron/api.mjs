import { createCodec } from './protocol.mjs';

export const API_BASE = 'https://impressaofornecedordmz.apps.havan.com.br';
export const valueOf = (obj, key) => obj?.[key] ?? obj?.[key[0].toLowerCase() + key.slice(1)];
const MAX_RESPONSE = 32 * 1024 * 1024;
class InconclusiveOrderList extends Error {}

async function hasEmptyBody(response) {
  if (!response.body) return true;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      if (value.byteLength) return false;
    }
  } catch { return false; }
  finally { await reader.cancel().catch(() => {}); }
}

export class HavanClient {
  constructor(key, fetcher = fetch) {
    this.codec = createCodec(key);
    this.fetcher = fetcher;
    this.user = null;
    this.orders = new Map();
    this.headers = new Map();
    this.busy = false;
  }
  logout() { this.user = null; this.orders.clear(); this.headers.clear(); }
  async request(route, payload) {
    let response;
    try {
      response = await this.fetcher(`${API_BASE}/Api/${route}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ Objeto: this.codec.encrypt(payload), Status: 200, Mensagem: '' }),
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error('Sem resposta da Havan. Confira a conexão. A operação não será repetida automaticamente; consulte o pedido antes de gerar novamente.');
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) this.logout();
      // A listagem geral pode responder 500 sem corpo quando não há pedidos
      // elegíveis. Não confundir isso com uma lista vazia confirmada.
      if (route === 'buscar-todos-por-fornecedor' && response.status === 500 && await hasEmptyBody(response))
        throw new InconclusiveOrderList('A consulta geral de pedidos retornou HTTP 500 sem conteúdo.');
      throw new Error(`A Havan recusou a requisição (HTTP ${response.status}).`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_RESPONSE) throw new Error('Resposta maior que o limite de 32 MB.');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    let envelope;
    try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('A Havan não retornou uma resposta JSON válida.'); }
    const status = Number(valueOf(envelope, 'Status'));
    if (status !== 200) {
      if ([401, 403].includes(status)) this.logout();
      // Não repassar respostas arbitrárias que podem conter dados confidenciais.
      throw new Error(status === 204 ? 'Nenhum resultado para esta consulta.' :
        `A Havan não autorizou ou não concluiu a operação (status ${status || 'desconhecido'}).`);
    }
    return this.codec.decrypt(valueOf(envelope, 'Objeto'));
  }
  requireSession() {
    if (!this.user) throw new Error('Faça login novamente para consultar a Havan.');
  }
  async login({ username, password }) {
    this.logout();
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password.trim())
      throw new Error('Preencha o CNPJ e a senha de fornecedor.');
    // TipoLogin.CNPJ = 0, conforme a tela original; não oferece perfis privilegiados.
    const user = await this.request('autenticacao-interna',
      { Usuario: username.trim(), Senha: password.trim(), Tipo: 0 });
    if (!user || Number(valueOf(user, 'Situacao')) !== 0 || valueOf(user, 'CadastroRfidOk') !== true)
      throw new Error('O cadastro não está ativo ou não está habilitado pela Havan. Consulte o suporte de fornecedor.');
    const person = valueOf(user, 'Pessoa');
    if (!person || !valueOf(person, 'Documento') || valueOf(user, 'EBureau'))
      throw new Error('Esta versão atende contas de fornecedor direto, não contas de bureau.');
    this.user = user;
    // Somente a identidade pública mínima atravessa o IPC.
    return { name: valueOf(user, 'Nome') || valueOf(person, 'Nome') || 'Fornecedor',
      document: valueOf(person, 'Documento') };
  }
  async queryOrders(filters) {
    try { return { orders: await this.listOrders(filters), inconclusive: false }; }
    catch (error) {
      if (!(error instanceof InconclusiveOrderList)) throw error;
      this.orders.clear();
      this.headers.clear();
      return { orders: [], inconclusive: true };
    }
  }
  async listOrders(filters) {
    this.requireSession();
    const code = String(filters.code ?? '').trim();
    if (code && !/^\d{4}-\d{1,12}$/.test(code))
      throw new Error('Informe o pedido no formato ano-número, por exemplo 2026-12345.');
    const year = Number(filters.year), week = Number(filters.week);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
        !Number.isInteger(week) || week < 0 || week > 53)
      throw new Error('Ano ou semana de entrega inválidos.');
    const u = this.user;
    const rows = await this.request(code ? 'buscar-por-pedido' : 'buscar-todos-por-fornecedor', {
      CNPJ: valueOf(valueOf(u, 'Pessoa'), 'Documento'), CodigoPedido: code,
      SituacaoPedido: 0, AnoSemanaEntrega: year, SemanaEntrega: week, StatusImpressaoPedido: 0,
      EBureau: false, CodigoEntidade: valueOf(u, 'Codigo'), IdFornecedor: valueOf(u, 'IdPessoa'),
      CodigoFornecedor: valueOf(u, 'CodigoEntidade'), CodigoFornecedorFiltro: '',
      FornecedorCnpj: null, PorcentagemImpressao: 0, ModeloEtiqueta: null,
    });
    if (!Array.isArray(rows)) throw new Error('Formato da lista de pedidos não reconhecido.');
    this.orders = new Map(rows.map(row => [valueOf(row, 'CodigoPedido'), row]));
    this.headers.clear();
    return rows.map(row => ({
      code: valueOf(row, 'CodigoPedido'), supplier: valueOf(row, 'NomeFornecedor'),
      issued: valueOf(row, 'DataEmissao'), week: valueOf(row, 'SemanaEntrega'),
      status: valueOf(row, 'SituacaoDescricao'), items: valueOf(row, 'QuantidadeItens'),
    }));
  }
  async listItems(orderCode) {
    this.requireSession();
    if (!this.orders.has(orderCode)) throw new Error('Selecione um pedido retornado para sua conta.');
    const header = await this.request('buscar-itens-impressao-sorter', {
      PedidoCodigo: orderCode, TipoImpressao: 0, ItensSorter: [], QuantidadeItens: 0,
      ModeloEtiqueta: null, EhRFID: false, ProdutosSorter: [],
    });
    if (valueOf(header, 'PedidoCodigo') !== orderCode || !Array.isArray(valueOf(header, 'ProdutosSorter')))
      throw new Error('Os itens retornados não correspondem ao pedido selecionado.');
    if (valueOf(header, 'EhRFID') === true)
      throw new Error('O pedido exige RFID. A adaptação 10×15 não substitui a gravação do chip.');
    this.headers.set(orderCode, header);
    return valueOf(header, 'ProdutosSorter').map((item, index) => ({
      index, code: valueOf(item, 'CodigoProduto'), name: valueOf(item, 'NomeProduto'),
      variation: valueOf(item, 'NomeVariacao'), quantity: valueOf(item, 'Quantidade'),
      pack: valueOf(item, 'CodigoPack'),
    }));
  }
  async generate(orderCode, indices) {
    this.requireSession();
    if (this.busy) throw new Error('Já existe uma geração em andamento.');
    const h = this.headers.get(orderCode);
    const all = valueOf(h, 'ProdutosSorter');
    if (!h || !Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length ||
        indices.some(i => !Number.isInteger(i) || !all[i]))
      throw new Error('Seleção de produtos inválida. Atualize os itens do pedido.');
    const products = indices.map(i => {
      const item = all[i];
      const quantity = Number(valueOf(item, 'Quantidade'));
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100000)
        throw new Error('Quantidade de volumes inválida.');
      const product = {};
      for (const key of ['CodigoEmpresa', 'TipoEstoque', 'Cdm', 'NumeroPedido',
        'CodigoProduto', 'NomeProduto', 'NomeVariacao', 'ProdutoUnidadeMedida',
        'CodigoPack', 'Quantidade', 'QuantidadeTotalPecas', 'TipoImpressao', 'CodigoVariacao'])
        product[key] = valueOf(item, key);
      return { ...product, EtiquetasImprimir: quantity, UltimaSequenciaImpressa: 0 };
    });
    this.busy = true;
    try {
      const result = await this.request('imprimir-etiquetas-sorter', {
        PedidoCodigo: orderCode, TipoImpressao: valueOf(h, 'TipoImpressao'),
        ItensSorter: [], QuantidadeItens: valueOf(h, 'QuantidadeItens'),
        ModeloEtiqueta: valueOf(h, 'ModeloEtiqueta'), EhRFID: false, ProdutosSorter: products,
      });
      const zpl = valueOf(result, 'CodigoZpl');
      if (typeof zpl !== 'string' || !zpl.length) throw new Error('A Havan não retornou etiquetas ZPL.');
      return zpl;
    } finally {
      this.busy = false;
      // Requer nova consulta após tentativa, inclusive em timeout ambíguo.
      this.headers.delete(orderCode);
    }
  }
}
