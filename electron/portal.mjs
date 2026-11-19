import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { MAX_INTEGRATION_BYTES, readIntegrationBuffer } from './integration.mjs';

export const PORTAL_ORIGIN = 'https://cliente.havan.com.br';
const INDEX = '/Fornecedor/PedidoCompra/Index';
const GRID = '/Fornecedor/PedidoCompra/GridIndexPedidoCompra';
const DOWNLOAD = '/Fornecedor/PedidoCompra/SetaPedidoVisualizadoBaixado';
const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const text = value => value.replace(/\s+/g, ' ').trim();
const isLogin = html => /action=["'][^"']*\/Login\/FazerLogin/i.test(html) || /class=["'][^"']*\bhvn-login\b/i.test(html);

export function safePortalUrl(value, base = PORTAL_ORIGIN) {
  const url = new URL(value, base);
  if (url.origin !== PORTAL_ORIGIN || url.username || url.password) throw new Error('O portal redirecionou para um endereço não autorizado.');
  return url;
}

export function parsePortalGrid(html) {
  if (isLogin(html)) throw new Error('A sessão do portal expirou. Faça login novamente.');
  const $ = load(html);
  $('script,style,link').remove();
  const orders = [];
  $('.hvn-group').each((_i, element) => {
    const block = $(element), fields = {};
    block.find('dt').each((_n, dt) => {
      const label = normalized(text($(dt).text()).replace(/:\s*$/, ''));
      if (label) fields[label] = text($(dt).next('dd').text());
    });
    const code = fields.pedido?.match(/\b\d{4}-\d+(?:-\d+)?\b/)?.[0];
    if (!code) return;
    let download;
    block.find('a[href]').each((_n, a) => {
      if (!normalized($(a).text()).includes('integracao')) return;
      const url = safePortalUrl($(a).attr('href'));
      if (url.pathname !== DOWNLOAD) throw new Error('Link de integração inesperado no portal.');
      for (const key of ['idPedido', 'idArquivo', 'idRelacao'])
        if (!/^\d{1,20}$/.test(url.searchParams.get(key) || '')) throw new Error('Identificador de download inválido.');
      const extension = (url.searchParams.get('extensaoArquivo') || '').toUpperCase();
      if (!['RAR', 'XML', 'ZIP'].includes(extension)) throw new Error('Formato de integração não suportado.');
      download = { href: url.href, extension };
    });
    const version = fields.versao || '';
    const key = createHash('sha256').update(`${code}|${version}|${download?.href || ''}`).digest('hex');
    orders.push({ key, code, version, status: text(block.find('dd').first().find('.tags-pedido-status').text()),
      delivery: fields['semana de entrega'] || '', invoice: fields['nota fiscal'] || '',
      scheduled: fields.agendamento || '', available: Boolean(download), download });
  });
  if (orders.length > 200) throw new Error('A consulta excede 200 pedidos. Use um filtro mais específico.');
  const paginated = $('.paginacao a, .pagination a, a[rel="next"]').length > 0;
  return { orders, paginated };
}

async function bodyBytes(response, limit) {
  if (!response.body) throw new Error('O portal retornou uma resposta vazia.');
  const reader = response.body.getReader(), parts = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('A resposta do portal excede o limite permitido.');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts);
}

// Cookie jar temporário do Electron; credenciais existem apenas durante login().
export class PortalClient {
  constructor(fetcher) { this.fetcher = fetcher; this.authenticated = false; this.orders = new Map(); }
  logout() { this.authenticated = false; this.orders.clear(); }
  async request(path, options = {}, followRedirects = true) {
    let url = safePortalUrl(path), method = options.method || 'GET';
    for (let redirects = 0; redirects <= 5; redirects++) {
      let response;
      try {
        response = await this.fetcher(url.href, {
          ...options, method, redirect: 'manual', credentials: 'include', signal: AbortSignal.timeout(45000),
        });
      } catch { throw new Error('Não foi possível consultar o portal. Nenhuma operação será repetida automaticamente.'); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!followRedirects) throw new Error('O portal exige uma verificação adicional. Conclua a verificação do site ou importe o XML/RAR local.');
        if (!location) throw new Error('Redirecionamento do portal sem destino.');
        url = safePortalUrl(location, url.href);
        if (/\/Login\//i.test(url.pathname)) { this.logout(); throw new Error('A sessão do portal expirou. Entre novamente.'); }
        if ([301, 302, 303].includes(response.status) && method !== 'GET')
          throw new Error('A consulta foi redirecionada. Verifique sua sessão no login oficial.');
        continue;
      }
      if (!response.ok) {
        if ([401, 403].includes(response.status)) this.logout();
        await response.body?.cancel();
        throw new Error(`Portal indisponível ou acesso recusado (HTTP ${response.status}). Use o login oficial para concluir eventuais verificações.`);
      }
      return response;
    }
    throw new Error('O portal excedeu o limite de redirecionamentos.');
  }
  async login({ username, password }) {
    this.logout();
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password.trim())
      throw new Error('Faça login em Acesso de fornecedor.');
    // Campos e envio sem transformação conforme o formulário público oficial.
    // Não tenta hashes alternativos nem repete um login recusado.
    const loginPath = '/Fornecedor/Login/Index';
    const html = (await bodyBytes(await this.request(loginPath, {}, false), 1024 * 1024)).toString('utf8');
    const $ = load(html), form = $('form#frmLogin');
    const action = safePortalUrl(form.attr('action') || loginPath);
    if (action.pathname !== '/Fornecedor/Login/FazerLogin' || !form.find('[name="SenhaMd5"]').length ||
        !form.find('[name="Documento"]').length)
      throw new Error('O portal exige uma verificação adicional. Conclua a verificação do site ou importe o XML/RAR local.');
    const body = new URLSearchParams({ TipoLogin: '0', Documento: username.trim(), Email: '', SenhaMd5: password.trim() });
    const token = form.find('input[name="__RequestVerificationToken"]').val();
    if (typeof token === 'string') body.set('__RequestVerificationToken', token);
    const response = await this.request(action.href, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest', Referer: `${PORTAL_ORIGIN}${loginPath}` }, body: body.toString(),
    }, false);
    const raw = await bodyBytes(response, 1024 * 1024);
    let result;
    try { result = JSON.parse(raw.toString('utf8')); } catch { /* Confirma a sessão, não o texto da resposta. */ }
    if (result?.Sucesso === false || result?.CadastrarEmail === true)
      throw new Error('O portal não confirmou o acesso ou exige uma etapa adicional. Conclua a verificação do site ou faça login novamente na Central.');
    if (!(await this.checkSession()).authenticated)
      throw new Error('O portal não confirmou a sessão. Conclua a verificação do site ou faça login novamente na Central.');
    return { authenticated: true };
  }
  async checkSession() {
    this.logout();
    const html = (await bodyBytes(await this.request(INDEX), 4 * 1024 * 1024)).toString('utf8');
    const $ = load(html);
    this.authenticated = !isLogin(html) && (
      html.includes('GridIndexPedidoCompra') ||
      ($('[name="Pedido"]').length > 0 && $('[name="OpcaoSituacaoPedidoCompra"]').length > 0));
    return { authenticated: this.authenticated };
  }
  async listOrders({ code = '' } = {}) {
    if (!this.authenticated) throw new Error('Faça login em Acesso de fornecedor para consultar as integrações.');
    if (typeof code !== 'string' || (code.trim() && !/^\d{4}-\d+(?:-\d+)?$/.test(code.trim())))
      throw new Error('Informe o pedido completo, por exemplo 2026-12345.');
    this.orders.clear();
    const body = new URLSearchParams({
      OpcaoCompradorPedidoCompra: '', Pedido: code.trim(), OpcaoSituacaoPedidoCompra: 'T',
      NotaFiscal: '', OpcaoStatusNotaFiscal: '0', OpcaoAnoEntregaPedidoCompraInicio: '',
      OpcaoSemanaAnoEntregaPedidoCompraInicio: '', OpcaoAnoEntregaPedidoCompraFinal: '',
      OpcaoSemanaAnoEntregaPedidoCompraFinal: '', OpcaoDataEmissaoOrdemCompraInicial: '01/01/2000',
      OpcaoDataEmissaoOrdemCompraFinal: '01/01/2222', 'X-Requested-With': 'XMLHttpRequest',
    });
    const response = await this.request(GRID, {
      method: 'POST', headers: { Accept: '*/*', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest', Referer: `${PORTAL_ORIGIN}${INDEX}` }, body: body.toString(),
    });
    const html = (await bodyBytes(response, 4 * 1024 * 1024)).toString('utf8');
    if (isLogin(html)) { this.logout(); throw new Error('A sessão do portal expirou. Entre novamente.'); }
    const parsed = parsePortalGrid(html);
    this.orders = new Map(parsed.orders.map(order => [order.key, order]));
    return { orders: parsed.orders.map(({ download, ...order }) => order), paginated: parsed.paginated };
  }
  async download(key) {
    if (!this.authenticated) throw new Error('A sessão do portal não está ativa.');
    const order = this.orders.get(key);
    if (!order?.download) throw new Error('Selecione um pedido com integração disponível nesta consulta.');
    const response = await this.request(order.download.href, { headers: {
      Accept: 'application/octet-stream, application/xml, */*', Referer: `${PORTAL_ORIGIN}${INDEX}`,
    } });
    const bytes = await bodyBytes(response, MAX_INTEGRATION_BYTES);
    if (bytes.subarray(0, 1000).toString('utf8').match(/<!DOCTYPE html|<html/i)) {
      this.logout(); throw new Error('O portal retornou uma página em vez da integração. Verifique o login oficial.');
    }
    const integration = await readIntegrationBuffer(bytes, `integracao-${order.code}.${order.download.extension}`, order.code);
    return { ...integration, portalVersion: order.version };
  }
}
