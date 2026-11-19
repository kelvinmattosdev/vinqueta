import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { CredentialVault } from '../electron/credential-vault.mjs';

test('credencial só vai para o cofre, com consentimento persistente e isolamento por perfil', async t => {
  const root = await mkdtemp('/tmp/opencode/vinqueta-vault-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const entries = new Map();
  const calls = [];
  const service = async (action, profile, value) => {
    calls.push(action);
    if (action === 'save') entries.set(profile, value);
    if (action === 'load') return entries.get(profile) || '';
    if (action === 'clear') entries.delete(profile);
  };
  const vault = new CredentialVault(root, service);
  assert.equal(await vault.load(), null);
  assert.deepEqual(calls, []);
  const fake = { username: 'cnpj-ficticio', password: 'senha-ficticia\n123' };
  await vault.save(fake);
  assert.deepEqual(await readdir(root), ['acesso-salvo']);
  assert.equal(await readFile(vault.marker, 'utf8'), '1');
  const reopened = new CredentialVault(root, service);
  assert.deepEqual(await reopened.load(), fake);
  const other = new CredentialVault(`${root}/outro`, service);
  assert.notEqual(other.profile, vault.profile);
  assert.equal(await other.load(), null);
  await reopened.forget();
  assert.equal(await vault.load(), null);
  assert.equal(entries.size, 0);
});

test('cofre indisponível não grava credenciais; falha ao apagar desliga a entrada automática', async t => {
  const root = await mkdtemp('/tmp/opencode/vinqueta-vault-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  let locked = true;
  const failure = new Error('Cofre bloqueado');
  const vault = new CredentialVault(root, async () => { if (locked) throw failure; });
  const fake = { username: 'ficticio', password: 'ficticia' };
  await assert.rejects(vault.save(fake), failure);
  assert.deepEqual(await readdir(root), []);
  locked = false;
  await vault.save(fake);
  locked = true;
  await assert.rejects(vault.load(), failure);
  await assert.rejects(vault.forget(), failure);
  assert.equal(await vault.load(), null);
});
