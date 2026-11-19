import test from 'node:test';
import assert from 'node:assert/strict';
import { PortalClient, parsePortalGrid, PORTAL_ORIGIN } from '../electron/portal.mjs';
import { gridHtml, integrationBytes } from './integration-fixture.mjs';

const loggedIndex = '<form><input name="Pedido"><select name="OpcaoSituacaoPedidoCompra"></select></form>';
test('lê o HTML como dados, preserva versões e pedidos sem integração; não executa scripts', () => {
  const result = parsePortalGrid(gridHtml);
  assert.equal(result.orders.length, 2);
  assert.equal(result.orders[0].code, '2026-12345');
  assert.equal(result.orders[0].version, '13/11/2026 17:16:29');
  assert.equal(result.orders[0].available, true);
  assert.equal(result.orders[1].code, '2025-12345-1');
  assert.equal(result.orders[1].available, false);
  assert.match(result.orders[0].download.href, /idArquivo=456/);
});
test('links externos e IDs malformados são rejeitados antes de qualquer download', () => {
  assert.throws(() => parsePortalGrid(gridHtml.replace('href="/Fornecedor/PedidoCompra/Seta', 'href="https://outro.example/Fornecedor/PedidoCompra/Seta')), /não autorizado/);
  assert.throws(() => parsePortalGrid(gridHtml.replace('idArquivo=456', 'idArquivo=abc')), /inválido/);
});
test('sessão do portal é explícita, usa cookie jar do transporte e IDs somente da consulta', async () => {
  const calls = [];
  const client = new PortalClient(async (url, options) => {
    calls.push({ url, options });
    return new Response(url.endsWith('/Index') ? loggedIndex : url.includes('/Grid') ? gridHtml : integrationBytes());
  });
  await assert.rejects(client.listOrders({ code: '' }), /Acesso de fornecedor/);
  assert.equal((await client.checkSession()).authenticated, true);
  const result = await client.listOrders({ code: '2026-12345' });
  assert.equal(result.orders[0].download, undefined);
  assert.equal(new URLSearchParams(calls[1].options.body).get('Pedido'), '2026-12345');
  await assert.rejects(client.download('id-inventado'));
  const integration = await client.download(result.orders[0].key);
  assert.equal(integration.rows[0].price, '199,99');
  assert.equal(integration.portalVersion, '13/11/2026 17:16:29');
  assert(calls.every(c => c.url.startsWith(PORTAL_ORIGIN) && c.options.credentials === 'include'));
  assert(calls.every(c => !JSON.stringify(c.options).includes('Senha')));
});
test('não segue redirecionamento externo nem tenta contornar login expirado', async () => {
  const client = new PortalClient(async () => new Response(null, { status: 302, headers: { location: 'https://outro.example' } }));
  await assert.rejects(client.checkSession(), /não autorizado/);
  const expired = new PortalClient(async () => new Response(null, { status: 302, headers: { location: '/Fornecedor/Login/Index' } }));
  await assert.rejects(expired.checkSession(), /expirou/);
  assert.equal(expired.authenticated, false);
});
test('resposta de login não é confundida com lista vazia ou sessão válida', async () => {
  const client = new PortalClient(async () => new Response('<form action="/Fornecedor/Login/FazerLogin"></form>'));
  assert.equal((await client.checkSession()).authenticated, false);
  assert.throws(() => parsePortalGrid('<div class="hvn-login"></div>'), /expirou/);
});

const loginHtml = '<form id="frmLogin" action="/Fornecedor/Login/FazerLogin?Length=5"><input name="Documento"><input name="SenhaMd5"><input name="__RequestVerificationToken" value="token-ficticio"></form>';
test('autentica com campos oficiais e confirma a sessão, sem guardar senha', async () => {
  let posted = 0;
  const client = new PortalClient(async (url, options) => {
    if (url.includes('FazerLogin')) {
      posted++;
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('Documento'), '123');
      assert.equal(body.get('SenhaMd5'), 'senha-ficticia');
      assert.equal(body.get('TipoLogin'), '0');
      assert.equal(body.get('__RequestVerificationToken'), 'token-ficticio');
      return Response.json({ Sucesso: true });
    }
    return new Response(url.includes('/Login/') ? loginHtml : loggedIndex);
  });
  assert.equal((await client.login({ username: '123', password: 'senha-ficticia' })).authenticated, true);
  assert.equal(posted, 1);
  assert(!JSON.stringify(client).includes('senha-ficticia'));
});
test('falha/challenge/redirecionamento do login não causam replay de credenciais', async () => {
  for (const failure of [
    () => Response.json({ Sucesso: false, Mensagem: 'NÃO REPASSAR' }),
    () => new Response(null, { status: 307, headers: { location: '/outra-rota' } }),
    () => new Response('<html>verificação</html>'),
  ]) {
    let posted = 0;
    const client = new PortalClient(async (url, options) => {
      if (options.method === 'POST') { posted++; return failure(); }
      return new Response(url.includes('/Login/') ? loginHtml : '<html>sem sessão</html>');
    });
    await assert.rejects(client.login({ username: '123', password: 'senha-ficticia' }), error => !error.message.includes('NÃO REPASSAR'));
    assert.equal(posted, 1);
    assert.equal(client.authenticated, false);
  }
});
