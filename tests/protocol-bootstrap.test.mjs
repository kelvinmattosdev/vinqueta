import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BOOTSTRAP_FILE, decodeBootstrap, encodeBootstrap, ProtocolVault } from '../electron/protocol-bootstrap.mjs';

const key = 'frase-sintética-para-testes';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'vinqueta-bootstrap-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bootstrapFile = join(root, BOOTSTRAP_FILE);
  await writeFile(bootstrapFile, encodeBootstrap(key));
  const legacyFile = join(root, 'protocol.json');
  const options = { legacyFiles: [legacyFile], bootstrapFile };
  const calls = [];
  const database = new Map();
  const service = async (action, profile, value, schema) => {
    calls.push(action);
    assert.match(schema, /\.VolumeProtocol$/);
    if (action === 'load') return database.get(profile) || '';
    if (action === 'save') database.set(profile, value);
  };
  return { bootstrapFile, calls, legacyFile, options, root, service };
}

test('o arquivo ofuscado não contém a frase em texto claro e detecta alterações', () => {
  const encoded = encodeBootstrap(key);
  assert.equal(encoded.includes(Buffer.from(key)), false);
  assert.notDeepEqual(encoded, encodeBootstrap(key));
  assert.equal(decodeBootstrap(encoded), key);
  encoded[encoded.length - 1] ^= 1;
  assert.throws(() => decodeBootstrap(encoded));
});

test('prepara a configuração uma vez e usa somente o cofre na próxima abertura', async t => {
  const { bootstrapFile, calls, options, root, service } = await fixture(t);
  assert.deepEqual(await new ProtocolVault(root, service).initialize(options), { key });
  assert.deepEqual(calls.splice(0), ['load', 'save', 'load']);
  await rm(bootstrapFile);
  assert.deepEqual(await new ProtocolVault(root, service).initialize(options), { key });
  assert.deepEqual(calls, ['load']);
});

test('migra a configuração local existente sem alterar o arquivo original', async t => {
  const { legacyFile, options, root, service } = await fixture(t);
  await writeFile(legacyFile, JSON.stringify({ key: 'legado' }));
  assert.deepEqual(await new ProtocolVault(root, service).initialize(options), { key: 'legado' });
  assert.deepEqual(await new ProtocolVault(root, async () => { throw new Error(); }).initialize(options), { key: 'legado' });
});

test('não libera o bootstrap se o cofre estiver indisponível ou não confirmar a gravação', async t => {
  const { options, root } = await fixture(t);
  const locked = new ProtocolVault(root, async () => { throw new Error(); });
  const noWrite = new ProtocolVault(root, async () => '');
  const failure = { key: null, vaultUnavailable: true };
  assert.deepEqual(await locked.initialize(options), failure);
  assert.deepEqual(await noWrite.initialize(options), failure);
});
