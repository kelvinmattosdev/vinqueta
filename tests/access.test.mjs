import test from 'node:test';
import assert from 'node:assert/strict';
import { SupplierAccess } from '../electron/access.mjs';

function fixture({ apiFails = false, portalFails = false } = {}) {
  const calls = [];
  const api = {
    user: null, logout() { this.user = null; calls.push('api:logout'); },
    requireSession() { if (!this.user) throw new Error('Faça login'); },
    async login(input) {
      calls.push('api:login'); assert.equal(input.password, 'ficticia');
      if (apiFails) throw new Error('API recusou');
      this.user = {}; return { name: 'Teste', document: '123' };
    },
  };
  const portal = {
    authenticated: false, logout() { this.authenticated = false; calls.push('portal:logout'); },
    async login(input) {
      calls.push('portal:login'); assert.equal(input.password, 'ficticia');
      if (portalFails) throw new Error('Verificação necessária');
      this.authenticated = true;
    },
  };
  const access = new SupplierAccess(api, portal, async () => { calls.push('cookies:clear'); });
  return { access, api, portal, calls };
}
test('um único login autentica ambos; logout remove as duas sessões e cookies', async () => {
  const { access, api, portal, calls } = fixture();
  await access.login({ username: '123', password: 'ficticia' });
  assert.deepEqual(calls, ['api:logout', 'portal:logout', 'cookies:clear', 'api:login', 'portal:login']);
  access.requireSession();
  assert(!JSON.stringify(access).includes('ficticia'));
  await access.logout();
  assert.equal(api.user, null); assert.equal(portal.authenticated, false);
  assert.throws(() => access.requireSession(), /login/);
});
test('falha em qualquer serviço mantém a Central bloqueada', async () => {
  const failedApi = fixture({ apiFails: true });
  await assert.rejects(failedApi.access.login({ username: '123', password: 'ficticia' }));
  assert(!failedApi.calls.includes('portal:login'));
  const failedPortal = fixture({ portalFails: true });
  await assert.rejects(failedPortal.access.login({ username: '123', password: 'ficticia' }), /confirmar o acesso ao portal/);
  assert.equal(failedPortal.api.user, null);
  assert.equal(failedPortal.portal.authenticated, false);
  assert.equal(failedPortal.access.authenticated, false);
  assert.throws(() => failedPortal.access.requireSession(), /login/);
});
