import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, Platform } from 'electron-builder';
import { BOOTSTRAP_FILE, encodeBootstrap, readProtocolFile } from '../electron/protocol-bootstrap.mjs';

const target = process.argv[2];
const targets = {
  'linux-dir': [Platform.LINUX, ['dir']],
  linux: [Platform.LINUX, ['deb', 'AppImage']],
  win: [Platform.WINDOWS, ['nsis']],
  mac: [Platform.MAC, ['dmg']],
};
if (!Object.hasOwn(targets, target)) throw new Error('Destino de empacotamento inválido.');
const [platform, formats] = targets[target];
const input = process.env.VINQUETA_PROTOCOL_FILE;
const config = {};
let temporary;
try {
  if (input) {
    const key = await readProtocolFile(input).catch(() => { throw new Error('Configuração de volumes do build ausente ou inválida.'); });
    temporary = await mkdtemp(join(tmpdir(), 'vinqueta-package-'));
    await writeFile(join(temporary, BOOTSTRAP_FILE), encodeBootstrap(key), { mode: 0o600, flag: 'wx' });
    config.extraResources = [{ from: temporary, to: '.', filter: [BOOTSTRAP_FILE] }];
  }
  await build({ config, publish: 'never', targets: platform.createTarget(formats) });
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
