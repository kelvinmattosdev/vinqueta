import test from 'node:test';
import assert from 'node:assert/strict';
import { HavanClient, API_BASE } from '../electron/api.mjs';
import { createCodec, deriveKey } from '../electron/protocol.mjs';

const key = 'chave-local-de-teste-nao-e-real';
const codec = createCodec(key);
const user = { Situacao: 0, CadastroRfidOk: true, Pessoa: { Documento: '123', Nome: 'Teste' },
  Nome: 'Fornecedor teste', Codigo: 8, IdPessoa: 9, CodigoEntidade: '10', EBureau: false };
const response = (data, status = 200) => new Response(JSON.stringify({
  Status: status, Objeto: codec.encrypt(data), Mensagem: '',
}), { status: 200 });

test('codec RC2 preserva objetos, UTF-8 e padding', () => {
  for (const value of [{ Usuario: 'teste', Senha: 'não-real' }, '', 'ã'.repeat(100), [1, 2, 3]])
    assert.deepEqual(codec.decrypt(codec.encrypt(value)), value);
  assert.equal(deriveKey(key).length, 16);
  assert.throws(() => codec.decrypt('inválido'));
});
test('vetor independente produzido por PasswordDeriveBytes e RC2.Create do .NET 8', () => {
  assert.equal(deriveKey(key).toString('hex'), '13eef7b3620ed1cb1c0f6b435825bc2b');
  const encrypted = 'NT4IpT5YETcmCabn+uLvhIsIZYrZNJGb1LNxL3Az0p7I89NEaHMWjQ==';
  assert.equal(codec.encrypt({ Usuario: 'teste', Senha: 'não-real' }), encrypted);
  assert.deepEqual(codec.decrypt(encrypted), { Usuario: 'teste', Senha: 'não-real' });
});
test('consulta exige login real e usa somente origem fixa', async () => {
  const calls = [];
  const client = new HavanClient(key, async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('autenticacao-interna') ? response(user) : response([]);
  });
  await assert.rejects(client.listOrders({ code: '', year: 2026, week: 0 }), /login/);
  const identity = await client.login({ username: '123', password: 'teste' });
  assert.deepEqual(Object.keys(identity).sort(), ['document', 'name']);
  await client.listOrders({ code: '', year: 2026, week: 0 });
  assert.equal(calls.length, 2);
  assert(calls.every(c => c.url.startsWith(API_BASE + '/Api/')));
  assert(!calls[0].options.body.includes('"Senha"'));
  assert.equal(codec.decrypt(JSON.parse(calls[0].options.body).Objeto).Tipo, 0);
});
test('login inativo, cadastro incompleto e bureau não liberam sessão', async () => {
  for (const change of [{ Situacao: 1 }, { CadastroRfidOk: false }, { EBureau: true }]) {
    const client = new HavanClient(key, async () => response({ ...user, ...change }));
    await assert.rejects(client.login({ username: '123', password: 'teste' }));
    assert.equal(client.user, null);
  }
});
test('nenhuma repetição automática em falha de rede', async () => {
  let calls = 0;
  const client = new HavanClient(key, async () => { calls++; throw new Error('network'); });
  await assert.rejects(client.login({ username: '123', password: 'teste' }), /não será repetida/);
  assert.equal(calls, 1);
});
test('lista geral com 500 vazio é inconclusiva; outros erros não são ocultados', async () => {
  let reply, hits = 0;
  const client = new HavanClient(key, async () => { hits++; return reply(); });
  client.user = user;
  client.orders.set('2026-1', {});
  client.headers.set('2026-1', {});
  const filters = { code: '', year: 2026, week: 0 };
  reply = () => new Response(null, { status: 500 });
  assert.deepEqual(await client.queryOrders(filters), { orders: [], inconclusive: true });
  assert.equal(client.orders.size, 0);
  assert.equal(client.headers.size, 0);
  assert.equal(hits, 1);
  await assert.rejects(client.queryOrders({ ...filters, code: '2026-1' }), /HTTP 500/);
  reply = () => new Response('erro interno', { status: 500 });
  await assert.rejects(client.queryOrders(filters), /HTTP 500/);
  reply = () => new Response(null, { status: 503 });
  await assert.rejects(client.queryOrders(filters), /HTTP 503/);
  reply = () => response([]);
  assert.deepEqual(await client.queryOrders(filters), { orders: [], inconclusive: false });
});
test('geração usa somente produto retornado e invalida seleção após tentativa', async () => {
  const product = { CodigoProduto: '123', Quantidade: 100 };
  let request;
  const client = new HavanClient(key, async (_url, options) => {
    request = codec.decrypt(JSON.parse(options.body).Objeto);
    return response({ codigoZpl: '^XA^XZ' });
  });
  client.user = user;
  client.headers.set('2026-1', { TipoImpressao: 0, ProdutosSorter: [product], ModeloEtiqueta: 'caixa', QuantidadeItens: 1 });
  await assert.rejects(client.generate('outro-pedido', [0]));
  await client.generate('2026-1', [0]);
  assert.equal(request.EhRFID, false);
  assert.equal(request.ProdutosSorter[0].EtiquetasImprimir, 100);
  assert.equal(client.headers.has('2026-1'), false);
  await assert.rejects(client.generate('2026-1', [0]));
});
