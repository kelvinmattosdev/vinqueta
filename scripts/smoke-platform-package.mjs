import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { ProtocolVault } from '../electron/protocol-bootstrap.mjs';
import { secretService } from '../electron/credential-vault.mjs';

const executablePath = await realpath(resolve(process.argv[2]));
const profile = await realpath(await mkdtemp(join(tmpdir(), 'vinqueta-platform-')));
const protocol = join(profile, 'protocol.json');
const vault = new ProtocolVault(profile);
async function check() {
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`, '--disable-gpu'] });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'Acesso de fornecedor' }).waitFor();
    const status = await page.evaluate(() => window.vinqueta.status());
    assert.equal(status.data.protocol, true);
    assert.equal(status.data.authenticated, false);
  } finally { await app.close(); }
}
try {
  const key = 'configuracao-ficticia-teste-plataforma';
  await writeFile(protocol, JSON.stringify({ key }), { mode: 0o600 });
  await check();
  assert.equal(await vault.load(), key);
  await rm(protocol);
  await check();
  console.log(`PASS ${process.platform}: executável e configuração persistente no cofre. Sem chamadas à Havan.`);
} finally {
  await secretService('clear', vault.profile, '', 'com.kelvinmattosdev.vinqueta.VolumeProtocol').catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
