import { cp, mkdir, readFile, writeFile, access, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { exists, LEGACY_PROFILE, LEGACY_LAUNCHER_MARKER } from '../electron/profile-migration.mjs';
import { BOOTSTRAP_FILE } from '../electron/protocol-bootstrap.mjs';

const home = homedir();
const dataHome = process.env.XDG_DATA_HOME || join(home, '.local/share');
const configHome = process.env.XDG_CONFIG_HOME || join(home, '.config');
const targetRoot = join(home, '.local/opt/vinqueta');
const applications = join(dataHome, 'applications');
const desktopFile = join(applications, 'vinqueta.desktop');
const legacyDesktop = join(applications, `${LEGACY_PROFILE}.desktop`);
const marker = '# Managed by Vinqueta installer';
let priorVersion;
try {
  const previous = await readFile(desktopFile, 'utf8');
  if (!previous.includes(marker))
    throw new Error('O atalho existente não foi criado por este instalador. Nada foi sobrescrito.');
  priorVersion = previous.match(/^Exec=.*\/vinqueta\/(\d+\.\d+\.\d+)-\d+\/vinqueta"$/m)?.[1];
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await access(resolve('release/linux-unpacked/vinqueta'));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
// Cada instalação usa um diretório novo; versões anteriores e lotes não são apagados.
const destination = join(targetRoot, `${version}-${Date.now()}`);
await mkdir(targetRoot, { recursive: true });
await cp(resolve('release/linux-unpacked'), destination, { recursive: true, errorOnExist: true, force: false });
const executable = join(destination, 'vinqueta');
await chmod(executable, 0o755);
const icon = join(destination, 'vinqueta.png');
await cp(resolve('build/icon.png'), icon, { errorOnExist: true, force: false });
const configDirectory = join(configHome, 'vinqueta');
await mkdir(configDirectory, { recursive: true, mode: 0o700 });
// Primeira versão com changelog: a instalação local conhece a versão que substituiu.
if (priorVersion && priorVersion !== version) {
  try { await writeFile(join(configDirectory, 'updates-seen'), `${priorVersion}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
try {
  const existing = join(configDirectory, 'protocol.json');
  try { await access(await exists(join(destination, 'resources', BOOTSTRAP_FILE))
    ? join(destination, 'resources', BOOTSTRAP_FILE) : existing); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!await exists(join(configHome, LEGACY_PROFILE, 'protocol.json'))) {
      const protocol = await readFile('.local/protocol.json', 'utf8');
      await writeFile(existing, protocol, { flag: 'wx', mode: 0o600 });
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Sem configuração anterior: use “Importar configuração local” no aplicativo.');
}
await mkdir(applications, { recursive: true });
// Escape do formato Desktop Entry (não de shell); %% evita expansão de field codes.
const quoteExec = text => `"${text.replace(/[\\\"`$]/g, '\\$&').replace(/%/g, '%%')}"`;
const launcher = `${marker}
[Desktop Entry]
Type=Application
Version=1.0
Name=Vinqueta
Comment=Central de etiquetas de preço e volume
Exec=${quoteExec(executable)}
Icon=${icon}
Terminal=false
Categories=Office;
Keywords=Vinqueta;Etiquetas;Havan;ZPL;
StartupWMClass=vinqueta
StartupNotify=true
`;
await writeFile(desktopFile, launcher, { mode: 0o644 });
// Mantém atalhos fixados anteriormente, sem mostrar uma segunda entrada no menu.
try {
  const old = await readFile(legacyDesktop, 'utf8');
  if (old.includes(LEGACY_LAUNCHER_MARKER) || old.startsWith(marker))
    await writeFile(legacyDesktop, `${launcher}NoDisplay=true\n`, { mode: 0o644 });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
try { execFileSync('update-desktop-database', [applications], { stdio: 'ignore' }); } catch { /* Opcional. */ }
console.log(`Instalado: ${executable}\nAtalho: ${desktopFile}\nPesquise por “Vinqueta” no menu do Linux.`);
