const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
app.setName('vinqueta');
if (process.platform === 'linux') {
  app.setDesktopName('vinqueta.desktop');
  app.commandLine.appendSwitch('class', 'vinqueta');
}

let win, client, jobs, active = false;
function authorized(event) {
  return win && !win.isDestroyed() && event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame &&
    event.senderFrame.url === require('node:url').pathToFileURL(entry).href;
}
const entry = path.join(__dirname, '../dist/index.html');
const publicError = error => {
  // Somente mensagens da aplicação, nunca pilhas, corpo HTTP ou objetos da sessão.
  return error instanceof Error ? error.message : 'A operação falhou.';
};
function handle(channel, fn, { concurrent = false } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!authorized(event))
      return { ok: false, error: 'Origem não autorizada.' };
    if (!concurrent && active) return { ok: false, error: 'Aguarde a operação em andamento.' };
    if (!concurrent) active = true;
    try { return { ok: true, data: await fn(...args) }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
    finally { if (!concurrent) active = false; }
  });
}
function requireClient() {
  if (!client) throw new Error('A configuração de volumes ainda não está disponível.');
  return client;
}
app.whenReady().then(async () => {
  const { HavanClient } = await import('./api.mjs');
  const { JobStore } = await import('./jobs.mjs');
  const { PricePreviewRenderer } = await import('./price-preview.mjs');
  const { readIntegrationFile } = await import('./integration.mjs');
  const { PortalClient } = await import('./portal.mjs');
  const { SupplierAccess } = await import('./access.mjs');
  const { CredentialVault } = await import('./credential-vault.mjs');
  const { BOOTSTRAP_FILE, ProtocolVault, readProtocolFile } = await import('./protocol-bootstrap.mjs');
  const { Confirmations } = await import('./confirmations.mjs');
  const { UpdateService, parseChangelog } = await import('./updates.mjs');
  const { listPrinters, submitRaw } = await import('./printing.mjs');
  const { exists, migrateLegacyProfile, LEGACY_PROFILE, LEGACY_VAULT_SCHEMA } = await import('./profile-migration.mjs');
  const root = app.getPath('userData');
  const appData = app.getPath('appData');
  const legacy = path.join(appData, LEGACY_PROFILE);
  const defaultProfile = root === path.join(appData, 'vinqueta');
  if (defaultProfile) await migrateLegacyProfile(root, legacy);
  const legacyMarker = path.join(root, 'acesso-legado');
  const legacyVault = new CredentialVault(legacy, undefined, LEGACY_VAULT_SCHEMA);
  async function forgetLegacy() {
    if (!defaultProfile || !await exists(legacyMarker)) return;
    await fs.rm(legacyMarker, { force: true });
    await legacyVault.forget();
  }
  const portalSession = session.fromPartition('havan-portal', { cache: false });
  portalSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const portal = new PortalClient((url, options) => portalSession.fetch(url, options));
  const priceRenderer = new PricePreviewRenderer();
  const vault = new CredentialVault(root);
  const localNotes = parseChangelog(await fs.readFile(path.join(app.getAppPath(), 'CHANGELOG.md'), 'utf8').catch(() => ''));
  const updates = new UpdateService(app.getVersion(), path.join(root, 'updates-seen'), localNotes);
  let autoAttempted = false;
  jobs = new JobStore(path.join(root, 'lotes'));
  const protocolVault = new ProtocolVault(root);
  const legacyFiles = [path.join(root, 'protocol.json')];
  if (!app.isPackaged) legacyFiles.push(path.join(app.getAppPath(), '.local/protocol.json'));
  const protocol = await protocolVault.initialize({
    legacyFiles, bootstrapFile: app.isPackaged ? path.join(process.resourcesPath, BOOTSTRAP_FILE) : null,
  }).catch(() => ({ key: null }));
  if (protocol.key) client = new HavanClient(protocol.key);
  const access = new SupplierAccess(client, portal, async () => {
    await portalSession.clearStorageData();
    await portalSession.clearAuthCache();
  });
  function workspace(channel, fn) {
    handle(channel, async (...args) => {
      access.requireSession();
      try { return await fn(...args); }
      finally { if (!access.authenticated) await access.logout().catch(() => {}); }
    });
  }
  const confirmations = new Confirmations(path.join(root, 'avisos.json'), options =>
    win.webContents.send('app:confirmation', options));
  // Resposta ao modal não usa a fila de operações: ela libera a operação pendente.
  ipcMain.on('app:confirmation-response', (event, input) => {
    if (authorized(event)) void confirmations.respond(input);
  });
  win = new BrowserWindow({
    title: 'Vinqueta', width: 1400, height: 920, minWidth: 960, minHeight: 700, show: false,
    icon: path.join(__dirname, '../build/icon.png'),
    backgroundColor: '#f3f3f3', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { confirmations.cancel(); portal.logout(); });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"],
    },
  }));
  handle('app:status', () => ({ protocol: Boolean(client), protocolVaultUnavailable: !client && Boolean(protocol.vaultUnavailable),
    storage: path.join(root, 'lotes'),
    authenticated: access.authenticated }));
  handle('app:author-github', () => shell.openExternal('https://github.com/kelvinmattosdev'));
  // A consulta pública não usa nem bloqueia as operações autenticadas da Havan.
  handle('updates:check', () => { access.requireSession(); return updates.check(); }, { concurrent: true });
  handle('updates:acknowledge', version => { access.requireSession(); return updates.acknowledge(version); }, { concurrent: true });
  handle('updates:open', version => {
    access.requireSession();
    const url = updates.releaseUrl(version);
    if (!url) throw new Error('Release não disponível. Verifique as atualizações novamente.');
    return shell.openExternal(url);
  }, { concurrent: true });
  workspace('app:reset-warnings', () => confirmations.reset());
  handle('app:import-config', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Importar configuração local de compatibilidade', properties: ['openFile'],
      filters: [{ name: 'Configuração local', extensions: ['json'] }],
    });
    if (result.canceled) return false;
    const key = await readProtocolFile(result.filePaths[0]).catch(() => { throw new Error('Arquivo de configuração inválido.'); });
    await protocolVault.save(key);
    await access.logout();
    client = new HavanClient(key);
    access.api = client;
    return true;
  });
  handle('api:login', async (data, remember) => {
    requireClient();
    const identity = await access.login(data);
    try {
      if (remember === true) await vault.save(data);
      else await vault.forget();
      await forgetLegacy();
      return { identity };
    } catch {
      return { identity, warning: remember === true
        ? 'Você entrou, mas não foi possível salvar o acesso no cofre do sistema.'
        : 'Você entrou, mas não foi possível remover o acesso antigo do cofre.' };
    }
  });
  handle('api:auto-login', async () => {
    if (!client || autoAttempted) return null;
    const remembered = await vault.enabled() ? vault : defaultProfile && await exists(legacyMarker) ? legacyVault : null;
    if (!remembered) return null;
    autoAttempted = true;
    let credentials;
    try { credentials = await remembered.load(); }
    catch { throw new Error('Não foi possível abrir o acesso salvo no cofre do sistema. Desbloqueie o cofre ou entre manualmente.'); }
    if (!credentials) return null;
    try {
      const identity = await access.login(credentials);
      if (remembered === legacyVault) {
        try { await vault.save(credentials); await forgetLegacy(); }
        catch { /* O acesso atual não depende de gravar de novo no cofre. */ }
      }
      return identity;
    }
    catch {
      await (remembered === legacyVault ? forgetLegacy() : vault.forget()).catch(() => {});
      throw new Error('Não foi possível entrar automaticamente. Entre manualmente e marque a opção de lembrar se quiser salvar o acesso novamente.');
    }
  });
  handle('api:logout', async () => {
    let warning;
    try {
      const results = await Promise.allSettled([vault.forget(), forgetLegacy()]);
      if (results.some(result => result.status === 'rejected')) throw new Error();
    }
    catch { warning = 'Não foi possível remover o acesso salvo por completo. Verifique o cofre de senhas do sistema.'; }
    await access.logout();
    return { warning };
  });
  workspace('api:orders', filters => requireClient().queryOrders(filters));
  workspace('api:items', code => requireClient().listItems(code));
  workspace('api:generate', async (code, indices) => {
    const confirmed = await confirmations.ask('volume-generate', {
      confirmLabel: 'Solicitar etiquetas',
      title: `Solicitar etiquetas do pedido ${String(code).slice(0, 40)}?`,
      detail: 'Esta operação pode registrar novos volumes na Havan. Não é uma reimpressão. Se já gerou estes volumes, use o lote salvo. Não haverá repetição automática.',
    });
    if (!confirmed) return null;
    const original = await requireClient().generate(code, indices);
    try { return await jobs.save([{ name: `pedido-${code}.txt`, zpl: original }], `Pedido ${code}`); }
    catch {
      throw new Error(`A Havan retornou o ZPL, mas o ajuste falhou. Verifique os arquivos .original.zpl em ${path.join(root, 'lotes')}. Não gere novamente antes dessa verificação.`);
    }
  });
  workspace('jobs:list', () => jobs.list());
  workspace('price:generate', inputs => jobs.savePrices(inputs));
  workspace('price:preview', options => priceRenderer.render(options));
  workspace('integration:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Importar arquivo de integração Havan', properties: ['openFile'],
      filters: [{ name: 'Integração XML, RAR ou ZIP', extensions: ['xml', 'rar', 'zip'] }],
    });
    return result.canceled ? null : readIntegrationFile(result.filePaths[0]);
  });
  workspace('portal:orders', filters => portal.listOrders(filters));
  workspace('portal:download', async key => {
    const order = portal.orders.get(key);
    if (!order?.available) throw new Error('Selecione uma integração disponível na consulta do portal.');
    const confirmed = await confirmations.ask('integration-download', {
      confirmLabel: 'Baixar integração',
      title: `Baixar integração do pedido ${order.code}?`,
      detail: 'Este download pode marcar o pedido como visualizado/baixado no portal da Havan. O arquivo será lido localmente para revisão; nenhuma etiqueta será impressa automaticamente.',
    });
    return !confirmed ? null : portal.download(key);
  });
  workspace('jobs:preview', async id => {
    const { job, files } = await jobs.load(id);
    return { job, text: files[0].zpl.slice(0, 16000) };
  });
  workspace('jobs:export', async id => {
    const archive = await jobs.archive(id);
    const result = await dialog.showSaveDialog(win, {
      title: 'Salvar etiquetas prontas', defaultPath: archive.name,
      filters: [{ name: 'Etiquetas ZPL', extensions: archive.name.endsWith('.zip') ? ['zip'] : ['txt'] }],
    });
    if (result.canceled) return false;
    // Não sobrescreve saídas já existentes.
    await fs.writeFile(result.filePath, archive.buffer, { flag: 'wx', mode: 0o600 });
    return true;
  });
  workspace('print:list', () => listPrinters());
  workspace('print:job', async (id, printer) => {
    if (typeof printer !== 'string' || !(await listPrinters()).includes(printer))
      throw new Error('Selecione uma fila de impressão instalada.');
    const { job, files } = await jobs.load(id);
    const confirmed = await confirmations.ask('print', {
      confirmLabel: 'Enviar para a impressora',
      title: `Enviar ${job.count} etiquetas para ${printer}?`,
      detail: `A fila precisa aceitar ZPL em modo raw. Confirme ${job.kind === 'price' ? 'etiquetas 33×22 mm em três colunas (880×200 dots por fileira)' : 'papel 100×150 mm'} e a resolução correta. O envio à fila não confirma a impressão física.`,
    });
    if (!confirmed) return null;
    const file = path.join(app.getPath('temp'), `vinqueta-${require('node:crypto').randomUUID()}.zpl`);
    try {
      await fs.writeFile(file, files.map(f => f.zpl).join('\n'), { mode: 0o600, flag: 'wx' });
      return await submitRaw(printer, file);
    } catch {
      throw new Error('Não foi possível confirmar o envio. Confira a fila antes de tentar novamente.');
    } finally { await fs.unlink(file).catch(() => {}); }
  });
  await win.loadFile(entry);
});
app.on('window-all-closed', () => { client?.logout(); app.quit(); });
