import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

const executablePath = await realpath(resolve(process.argv[2]));
const profile = await realpath(await mkdtemp(join(tmpdir(), 'vinqueta-platform-')));
const protocol = join(profile, 'protocol.json');
async function check(cleanup = false) {
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`, '--disable-gpu'] });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'Acesso de fornecedor' }).waitFor();
    const status = await page.evaluate(() => window.vinqueta.status());
    assert.equal(status.data.protocol, true);
    assert.equal(status.data.authenticated, false);
    if (cleanup) {
      // No Keychain, a entrada pertence ao executável que a criou, não ao Node do runner.
      await app.evaluate(async ({ app: desktop }) => {
        const require = process.getBuiltinModule('module').createRequire(`${desktop.getAppPath()}/package.json`);
        const { ProtocolVault } = require('./electron/protocol-bootstrap.mjs');
        const { secretService } = require('./electron/credential-vault.mjs');
        const vault = new ProtocolVault(desktop.getPath('userData'));
        await secretService('clear', vault.profile, '', 'com.kelvinmattosdev.vinqueta.VolumeProtocol');
      });
    }
  } finally { await app.close(); }
}
try {
  const key = 'configuracao-ficticia-teste-plataforma';
  await writeFile(protocol, JSON.stringify({ key }), { mode: 0o600 });
  await check();
  await rm(protocol);
  await check(true);
  console.log(`PASS ${process.platform}: executável e configuração persistente no cofre. Sem chamadas à Havan.`);
} finally {
  await rm(profile, { recursive: true, force: true });
}
