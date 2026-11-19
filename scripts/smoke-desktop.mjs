import { _electron as electron } from 'playwright-core';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { sample } from '../tests/fixture.mjs';
import { integrationBytes, gridHtml } from '../tests/integration-fixture.mjs';

const tmp = await mkdtemp('/tmp/opencode/vinqueta-desktop-');
let desktop;
async function mockHavan() {
  await desktop.evaluate(({ app }, { grid, xml, zpl }) => {
    const require = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`);
    const { HavanClient } = require(`${app.getAppPath()}/electron/api.mjs`);
    const { PortalClient } = require(`${app.getAppPath()}/electron/portal.mjs`);
    const { CredentialVault } = require(`${app.getAppPath()}/electron/credential-vault.mjs`);
    const { UpdateService } = require(`${app.getAppPath()}/electron/updates.mjs`);
    UpdateService.prototype.loadPublicReleases = async function() {
      return globalThis.testReleases ?? [{ version: this.version, tag: `v${this.version}`, body: '' }];
    };
    let stored;
    CredentialVault.prototype.service = async (action, _profile, secret) => {
      if (action === 'save') stored = secret;
      else if (action === 'clear') stored = undefined;
      else if (action === 'load') return stored || '';
    };
    globalThis.testCounts = { apiLogins: 0, portalLogins: 0, orders: 0, downloads: 0 };
    const originalRequest = HavanClient.prototype.request;
    HavanClient.prototype.request = async function(route, payload) {
      if (route === 'autenticacao-interna') {
        globalThis.testCounts.apiLogins++;
        return { Situacao: 0, CadastroRfidOk: true, EBureau: false, Pessoa: { Documento: '123', Nome: 'Fornecedor sintético' } };
      }
      if (route === 'buscar-todos-por-fornecedor') {
        globalThis.testCounts.orders++;
        if (globalThis.testOrderGate) await globalThis.testOrderGate;
        if (globalThis.testEmptyHttp500)
          return originalRequest.call({ codec: this.codec, fetcher: async () => new Response(null, { status: 500 }) }, route, payload);
        return [{ CodigoPedido: '2026-12345', NomeFornecedor: 'Fornecedor sintético', QuantidadeItens: 1 }];
      }
      if (route === 'buscar-itens-impressao-sorter')
        return { PedidoCodigo: payload.PedidoCodigo, ProdutosSorter: [{ NomeProduto: 'Produto sintético', Quantidade: 1 }] };
      if (route === 'imprimir-etiquetas-sorter') return { CodigoZpl: zpl };
      throw new Error('Chamada inesperada no teste');
    };
    PortalClient.prototype.request = async function(path, options = {}) {
      if (path.includes('FazerLogin')) {
        globalThis.testCounts.portalLogins++;
        if (new URLSearchParams(options.body).get('SenhaMd5') !== 'senha-sintetica') throw new Error('Senha de teste não reaproveitada');
        return new Response(JSON.stringify({ Sucesso: !globalThis.testPortalFailure }));
      }
      if (path.includes('/Login/')) return new Response('<form id="frmLogin" action="/Fornecedor/Login/FazerLogin"><input name="Documento"><input name="SenhaMd5"></form>');
      if (path.includes('GridIndex')) {
        if (globalThis.testExpired) this.logout();
        return new Response(globalThis.testExpired ? '<div class="hvn-login"></div>' : grid);
      }
      if (path.includes('SetaPedido')) { globalThis.testCounts.downloads++; return new Response(Buffer.from(xml, 'base64')); }
      return new Response('<input name="Pedido"><select name="OpcaoSituacaoPedidoCompra"></select>');
    };
  }, { grid: gridHtml, xml: integrationBytes().toString('base64'), zpl: sample });
}
async function login(page) {
  await page.getByLabel('CNPJ do fornecedor').fill('123');
  await page.getByLabel('Senha', { exact: true }).fill('senha-sintetica');
  await page.getByRole('button', { name: 'Entrar na Havan' }).click();
}
const launchOptions = process.env.VINQUETA_EXECUTABLE ? {
  executablePath: resolve(process.env.VINQUETA_EXECUTABLE),
  args: ['--disable-gpu', `--user-data-dir=${tmp}/profile`],
} : { args: [resolve('.'), '--disable-gpu', `--user-data-dir=${tmp}/profile`] };
try {
  const output = join(tmp, 'exportado.txt');
  // O teste instalado não depende de uma configuração real de fornecedor.
  await mkdir(join(tmp, 'profile'), { recursive: true });
  await writeFile(join(tmp, 'profile', 'protocol.json'), JSON.stringify({ key: 'chave-sintetica' }));
  desktop = await electron.launch(launchOptions);
  const page = await desktop.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Acesso de fornecedor' }).waitFor();
  await page.getByRole('button', { name: 'Entrar na Havan' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.progress'));
  assert.equal(await page.title(), 'Vinqueta');
  assert.equal(await page.locator('.login-brand img').evaluate(async img => { await img.decode(); return img.naturalWidth; }), 1254);
  const author = page.getByRole('link', { name: 'Kelvin Mattos', exact: true });
  assert.equal(await author.getAttribute('href'), 'https://github.com/kelvinmattosdev');
  await desktop.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.vinquetaTestExternal = url; }; });
  await author.click();
  assert.equal(await desktop.evaluate(() => globalThis.vinquetaTestExternal), 'https://github.com/kelvinmattosdev');
  let status = await page.evaluate(() => window.vinqueta.status());
  assert.equal(status.ok, true);
  assert(status.data.storage.startsWith(tmp), 'O teste nunca deve usar a pasta real de lotes');
  if (!status.data.protocol) {
    const protocolFile = resolve('.local/protocol.json');
    await desktop.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, protocolFile);
    await page.getByRole('button', { name: 'Importar configuração local' }).click();
    await page.waitForFunction(() => !document.querySelector('.progress'));
    status = await page.evaluate(() => window.vinqueta.status());
  }
  assert.equal(status.data.protocol, true);
  await mockHavan();
  assert.equal(await page.getByRole('navigation').count(), 0);
  assert.equal((await page.evaluate(() => window.vinqueta.history())).ok, false);
  assert.equal((await page.evaluate(() => window.vinqueta.checkUpdates())).ok, false);
  assert.equal((await page.evaluate(() => window.vinqueta.importIntegration())).ok, false);
  assert.equal(await page.evaluate(() => typeof window.vinqueta.importFile), 'undefined');
  await mkdir('test-results', { recursive: true });
  async function screenshot(name) {
    await page.evaluate(() => document.fonts.ready);
    const png = await desktop.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
    await writeFile(`test-results/${name}.png`, Buffer.from(png, 'base64'));
  }
  await screenshot('desktop-login');
  const loginRemember = page.getByRole('checkbox', { name: 'Lembrar acesso neste computador' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await loginRemember.focus();
  await loginRemember.press('Space');
  assert.equal(await loginRemember.isChecked(), true);
  await page.waitForFunction(() => document.querySelector('.login-remember .checkbox-mark path').getAnimations()
    .some(animation => animation.transitionProperty === 'stroke-dashoffset' && animation.effect.getTiming().duration === 350));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginRemember.press('Space');
  assert.equal(await loginRemember.isChecked(), false);
  const reducedCheck = await page.locator('.login-remember .checkbox-mark path').evaluate(el => ({
    offset: parseFloat(getComputedStyle(el).strokeDashoffset),
    running: el.getAnimations().length,
  }));
  assert.deepEqual(reducedCheck, { offset: 1, running: 0 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await desktop.evaluate(() => {
    globalThis.testOrderGate = new Promise(resolve => { globalThis.testReleaseOrders = resolve; });
  });
  await login(page);
  const orderResults = page.locator('.order-results');
  await orderResults.locator('.order-skeleton').waitFor();
  assert.equal(await orderResults.getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('.progress').count(), 0);
  assert.equal(await page.getByText(/^\d+ encontrados$/).count(), 0);
  assert.equal(await orderResults.getByRole('heading').count(), 0);
  assert.equal(await orderResults.locator('.order-skeleton-layout').evaluate(el => getComputedStyle(el).animationName), 'order-pulse');
  await desktop.evaluate(() => { globalThis.testReleaseOrders(); globalThis.testOrderGate = undefined; });
  await page.getByRole('button', { name: /Ver produtos/ }).waitFor();
  assert.equal(await orderResults.getAttribute('aria-busy'), 'false');
  assert.equal(await orderResults.locator('.order-list-reveal').evaluate(el => getComputedStyle(el).animationName), 'order-list-in');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal((await desktop.evaluate(() => globalThis.testCounts)).orders, 1);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  const lightChoice = page.getByRole('radio', { name: 'Claro', exact: true });
  const darkChoice = page.getByRole('radio', { name: 'Escuro', exact: true });
  await lightChoice.check();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await lightChoice.press('ArrowRight');
  assert.equal(await darkChoice.isChecked(), true);
  await page.waitForFunction(() => document.querySelector('.theme-pill').getAnimations()
    .some(animation => animation.transitionProperty === 'transform' && animation.effect.getTiming().duration === 250));
  await page.locator('.theme-pill').evaluate(async el => {
    await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const offset = await page.locator('.theme-track').evaluate(el =>
    el.querySelector('.theme-pill').getBoundingClientRect().left -
    el.querySelector('input[value=dark]').parentElement.getBoundingClientRect().left);
  assert(Math.abs(offset) < 1, 'Indicador deve alinhar com a opção selecionada');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await screenshot('desktop-settings-dark');
  await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
  // Substitui somente os diálogos no processo de teste, nunca no aplicativo entregue.
  await desktop.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, output);
  await page.getByRole('button', { name: /Ver produtos/ }).click();
  await page.getByRole('checkbox', { name: 'Selecionar Produto sintético' }).check();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: /Solicitar e ajustar/ }).click();
  const volumeConfirm = page.locator('.confirmation-dialog');
  assert.equal(await volumeConfirm.evaluate(el => getComputedStyle(el).animationName), 'modal-in');
  await page.getByRole('button', { name: 'Solicitar etiquetas', exact: true }).click();
  await volumeConfirm.waitFor({ state: 'detached' });
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(41, 53, 46)');
  await page.getByText('1 etiquetas', { exact: false }).first().waitFor();
  assert.match(await page.locator('.code-preview').innerText(), /\^FT25,1125/);
  await page.getByRole('button', { name: 'Exportar ajustado' }).click();
  const exportSuccess = page.getByRole('dialog').locator('.success-check');
  await exportSuccess.waitFor();
  assert.equal(await exportSuccess.evaluate(el => getComputedStyle(el.querySelector('path')).animationName), 'check-draw');
  await page.waitForFunction(() => !document.querySelector('.progress'));
  assert.match(await readFile(output, 'utf8'), /\^FT25,1125/);
  assert.match(await readFile(output, 'utf8'), /300000000000000000000001/);
  await screenshot('desktop-lote');
  const lotDialog = page.getByRole('dialog');
  const exit = await lotDialog.evaluate(el => {
    el.querySelector('[aria-label="Fechar lote"]').click();
    return el.getAnimations().find(a => a.effect.getTiming().duration === 150)?.effect.getTiming().duration;
  });
  assert.equal(exit, 150);
  await lotDialog.waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: /Lotes salvos/ }).click();
  await page.getByRole('button', { name: 'Abrir lote' }).waitFor();
  await page.getByRole('button', { name: 'Etiquetas de preço', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  const previewCard = page.locator('.price-preview-panel');
  const zplTab = previewCard.getByRole('button', { name: 'ZPL', exact: true });
  const labelTab = previewCard.getByRole('button', { name: 'Etiqueta', exact: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await zplTab.click();
  await page.waitForFunction(() => document.querySelector('.price-preview-panel').getAnimations().some(animation =>
    animation.effect.getKeyframes().some(frame => frame.height)));
  const resize = await previewCard.evaluate(el => {
    const animation = el.getAnimations().find(a => a.effect.getKeyframes().some(frame => frame.height));
    const frames = animation.effect.getKeyframes();
    const heights = frames.map(frame => parseFloat(frame.height));
    animation.pause();
    animation.currentTime = 150;
    const intermediate = el.getBoundingClientRect().height;
    animation.finish();
    return { heights, intermediate, final: el.getBoundingClientRect().height, duration: animation.effect.getTiming().duration };
  });
  assert.equal(resize.duration, 300);
  assert(resize.intermediate > Math.min(...resize.heights) && resize.intermediate < Math.max(...resize.heights));
  assert(Math.abs(resize.final - resize.heights[1]) < 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await labelTab.click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await previewCard.evaluate(el => el.getAnimations().some(a => a.effect.getKeyframes().some(frame => frame.height))), false);
  if (process.env.VINQUETA_LABELARY_LIVE === '1') {
    // Teste opt-in: envia somente dados sintéticos, nunca produtos/credenciais reais.
    await page.getByLabel('Nome do produto', { exact: true }).fill('Teste sintético');
    await page.getByLabel('EAN-13', { exact: true }).fill('1234567890128');
    await page.getByLabel('Preço de venda (R$)', { exact: true }).fill('349,90');
    await page.getByRole('button', { name: 'Enviar e renderizar no Labelary' }).click();
    const image = page.getByAltText('Etiqueta renderizada pelo Labelary a partir do ZPL gerado');
    await image.waitFor();
    await image.evaluate(img => img.decode());
    assert.equal(await image.evaluate(img => img.naturalWidth), 880);
    assert.equal(await image.evaluate(img => img.naturalHeight), 200);
    await page.locator('.content').evaluate(el => { el.scrollTop = 0; });
    await screenshot('desktop-labelary-real');
    await page.getByLabel('Preço de venda (R$)', { exact: true }).fill('99,99');
    assert.equal(await image.count(), 0, 'Uma edição invalida imediatamente a prévia anterior');
    console.log('PASS Labelary real: PNG 880×200 recebido no Electron; apenas dados sintéticos enviados.');
  }
  await page.getByLabel('Produto dos modelos').selectOption('exemplo-a');
  const ean = page.getByLabel('EAN-13', { exact: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await ean.fill('2000000000010');
  await page.getByRole('button', { name: 'Adicionar ao lote' }).click();
  assert.equal(await ean.getAttribute('aria-invalid'), 'true');
  assert(await ean.evaluate(el => el === document.activeElement && el.getAnimations().some(a => a.effect.getTiming().duration === 280)));
  await ean.fill('2000000000015');
  assert.equal(await ean.getAttribute('aria-invalid'), null);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Quantidade de etiquetas').fill('4');
  await page.getByRole('button', { name: 'Adicionar ao lote' }).click();
  assert.equal(await page.getByRole('button', { name: 'Gerar lote de preços' }).isDisabled(), true);
  await page.getByRole('checkbox', { name: 'Conferi os EANs, os preços atuais e as quantidades deste lote.' }).check();
  await screenshot('desktop-precos');
  const priceOutput = join(tmp, 'precos.txt');
  await desktop.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, priceOutput);
  await page.getByRole('button', { name: 'Gerar lote de preços' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByText('4 etiquetas', { exact: false }).first().waitFor();
  assert.match(await page.locator('.code-preview').innerText(), /\^FO12,20/);
  assert.doesNotMatch(await page.locator('.code-preview').innerText(), /Colar esta linha/);
  await page.getByRole('button', { name: 'Exportar preços' }).click();
  await page.waitForFunction(() => !document.querySelector('.progress'));
  const priceText = await readFile(priceOutput, 'utf8');
  assert.equal((priceText.match(/\^FD2000000000015\^FS/g) ?? []).length, 4);
  assert.match(priceText, /\^FD199\^FS/);
  assert.match(priceText, /\^FD,99\^FS/);
  await page.getByRole('button', { name: 'Fechar lote' }).click();
  await page.getByRole('button', { name: /Lotes salvos/ }).click();
  await page.getByText('Preço · 33×22', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Abrir lote' }).count(), 2);
  const integrationInput = process.env.VINQUETA_INTEGRATION_FILE || join(tmp, 'integracao.xml');
  if (!process.env.VINQUETA_INTEGRATION_FILE) await writeFile(integrationInput, integrationBytes());
  await desktop.evaluate(({ dialog }, input) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
  }, integrationInput);
  await page.getByRole('button', { name: 'Etiquetas de preço', exact: true }).click();
  await page.getByRole('button', { name: 'Importar XML ou RAR' }).click();
  await page.locator('.integration-review').waitFor();
  await page.getByRole('button', { name: 'Adicionar selecionados ao lote' }).click();
  assert.equal(await page.getByRole('button', { name: 'Gerar lote de preços' }).isDisabled(), true);
  await screenshot('desktop-integracao');
  await page.getByRole('checkbox', { name: 'Conferi os EANs, os preços atuais e as quantidades deste lote.' }).check();
  await page.getByRole('button', { name: 'Gerar lote de preços' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByText('1.200 etiquetas', { exact: false }).first().waitFor();
  await page.waitForFunction(() => document.querySelector('.code-preview')?.textContent.includes('^PQ400'));
  assert.match(await page.locator('.code-preview').innerText(), /\^PQ400/);
  const integrationOutput = join(tmp, 'integracao-precos.txt');
  await desktop.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, integrationOutput);
  await page.getByRole('button', { name: 'Exportar preços' }).click();
  await page.getByRole('dialog').getByText('Etiquetas de preço salvas.', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.progress'));
  assert.match(await readFile(integrationOutput, 'utf8'), /\^PQ400/);
  assert.match(await page.locator('.price-file-summary').innerText(), /XML do pedido/);
  await page.getByRole('button', { name: 'Fechar lote' }).click();
  assert.equal(await page.getByLabel('Senha', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Consultar portal' }).click();
  const download = page.getByRole('button', { name: 'Ler integração', exact: true });
  await download.click();
  const confirmation = page.getByRole('dialog', { name: 'Baixar integração do pedido 2026-12345?' });
  await confirmation.waitFor();
  assert.equal(await confirmation.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(41, 53, 46)');
  assert.equal(await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).evaluate(el => el === document.activeElement), true);
  await screenshot('desktop-confirmacao');
  await confirmation.getByRole('checkbox').check();
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal((await desktop.evaluate(() => globalThis.testCounts)).downloads, 0);
  await download.click();
  await confirmation.waitFor();
  await confirmation.press('Escape');
  assert.equal((await desktop.evaluate(() => globalThis.testCounts)).downloads, 0);
  await download.click();
  await confirmation.getByRole('checkbox').check();
  await confirmation.getByRole('button', { name: 'Baixar integração', exact: true }).click();
  await page.getByRole('heading', { name: 'Integração · 2026-12345', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.progress'));
  await download.click();
  await page.waitForFunction(() => !document.querySelector('.progress'));
  assert.equal(await confirmation.count(), 0);
  assert.deepEqual(await desktop.evaluate(() => globalThis.testCounts), { apiLogins: 1, portalLogins: 1, orders: 1, downloads: 2 });
  assert.equal(await page.getByRole('button', { name: 'Restaurar avisos', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar avisos', exact: true }).click();
  await page.getByText('Avisos de download, geração e impressão reativados.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Etiquetas de preço', exact: true }).click();
  await download.click();
  await confirmation.waitFor();
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await page.getByRole('heading', { name: 'Acesso de fornecedor', exact: true }).waitFor();
  assert.equal(await page.getByRole('navigation').count(), 0);
  const finalStatus = await page.evaluate(() => window.vinqueta.status());
  assert.equal(finalStatus.data.authenticated, false);
  await desktop.evaluate(() => { globalThis.testPortalFailure = true; });
  await login(page);
  await page.getByRole('alert').getByText(/Não foi possível confirmar o acesso ao portal/).waitFor();
  await page.waitForFunction(() => !document.querySelector('.progress'));
  const partialStatus = await page.evaluate(() => window.vinqueta.status());
  assert.equal(partialStatus.data.authenticated, false);
  assert.equal(await page.getByRole('navigation').count(), 0);
  assert.equal(await page.getByLabel('Senha', { exact: true }).inputValue(), '');
  await desktop.evaluate(() => { globalThis.testPortalFailure = false; globalThis.testExpired = true; });
  await login(page);
  await page.getByRole('button', { name: 'Etiquetas de preço', exact: true }).click();
  await page.getByRole('button', { name: 'Consultar portal' }).click();
  await page.getByRole('heading', { name: 'Acesso de fornecedor', exact: true }).waitFor();
  await page.getByRole('alert').getByText(/sessão do portal expirou/).waitFor();
  assert.equal(await page.getByLabel('Senha', { exact: true }).inputValue(), '');
  await page.reload();
  await page.getByRole('heading', { name: 'Acesso de fornecedor', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.deepEqual(errors, []);
  await desktop.close();
  await writeFile(join(tmp, 'profile', 'updates-seen'), '0.4.0\n');
  desktop = await electron.launch(launchOptions);
  const restarted = await desktop.firstWindow();
  await restarted.getByRole('heading', { name: 'Acesso de fornecedor', exact: true }).waitFor();
  assert.equal(await restarted.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await restarted.getByRole('navigation').count(), 0);
  await mockHavan();
  await desktop.evaluate(({ shell }) => {
    globalThis.testReleases = [
      { version: '0.5.1', tag: 'v0.5.1', body: '### Segurança\n- Nota de segurança fictícia.' },
      { version: '1.5.0', tag: 'v1.5.0', body: '' },
    ];
    shell.openExternal = async url => { globalThis.testOpenedRelease = url; };
  });
  const remember = restarted.getByRole('checkbox', { name: 'Lembrar acesso neste computador' });
  assert.equal(await remember.isChecked(), false);
  await remember.check();
  await login(restarted);
  const log = restarted.getByRole('dialog', { name: 'O que mudou na Vinqueta' });
  await log.waitFor();
  await log.getByRole('heading', { name: 'Versão 0.5.0', exact: true }).waitFor();
  await log.getByRole('heading', { name: 'Versão 0.6.1', exact: true }).waitFor();
  await log.getByText('Nota de segurança fictícia.', { exact: true }).waitFor();
  assert.equal(await log.getByRole('heading', { name: 'Versão 1.5.0', exact: true }).count(), 0);
  await log.getByRole('button', { name: 'Continuar', exact: true }).click();
  await log.waitFor({ state: 'detached' });
  assert.equal(await readFile(join(tmp, 'profile', 'updates-seen'), 'utf8'), '0.6.1\n');
  await restarted.getByRole('button', { name: 'Atualizar para 1.5.0' }).click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await desktop.evaluate(() => globalThis.testOpenedRelease), 'https://github.com/kelvinmattosdev/vinqueta/releases/tag/v1.5.0');
  await restarted.getByRole('button', { name: /Lotes salvos/ }).click();
  await restarted.getByRole('button', { name: 'Abrir lote' }).first().waitFor();
  await restarted.getByRole('button', { name: 'Configurações', exact: true }).click();
  assert.equal(await restarted.getByRole('radio', { name: /^Escuro/ }).isChecked(), true);
  assert.equal(await readFile(join(tmp, 'profile', 'acesso-salvo'), 'utf8'), '1');
  await desktop.evaluate(() => { globalThis.testReleases = undefined; });
  await restarted.reload();
  await restarted.getByRole('button', { name: /Ver produtos/ }).waitFor();
  await restarted.getByText('Atualizado 0.6.1', { exact: true }).waitFor();
  assert.equal(await log.count(), 0);
  assert.equal((await desktop.evaluate(() => globalThis.testCounts)).apiLogins, 2);
  assert.equal(await restarted.getByLabel('Senha', { exact: true }).count(), 0);
  await restarted.emulateMedia({ reducedMotion: 'no-preference' });
  await desktop.evaluate(() => {
    globalThis.testEmptyHttp500 = true;
    globalThis.testOrderGate = new Promise(resolve => { globalThis.testReleaseOrders = resolve; });
  });
  await restarted.getByRole('button', { name: 'Buscar pedidos' }).click();
  await restarted.locator('.order-results[data-state="loading"] .order-skeleton').waitFor();
  const empty = restarted.getByRole('heading', { name: 'Não foi localizado nenhum pedido em aberto' });
  assert.equal(await empty.count(), 0);
  await desktop.evaluate(() => { globalThis.testReleaseOrders(); globalThis.testOrderGate = undefined; });
  await empty.waitFor();
  assert.equal(await empty.evaluate(el => getComputedStyle(el).animationName), 'order-empty-in');
  assert.equal(await empty.evaluate(el => getComputedStyle(el).animationDelay), '0.04s');
  await restarted.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await empty.evaluate(el => getComputedStyle(el).animationName), 'none');
  await restarted.getByText('Se você esperava encontrar pedidos em aberto, por favor, reporte.').waitFor();
  assert.equal(await restarted.getByRole('alert').count(), 0);
  await restarted.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await restarted.getByRole('heading', { name: 'Acesso de fornecedor', exact: true }).waitFor();
  await assert.rejects(readFile(join(tmp, 'profile', 'acesso-salvo')), { code: 'ENOENT' });
  console.log('PASS Electron: login, entrada automática, esquecimento no logout, volumes/preços, histórico e preferências. Sem chamadas à Havan.');
} finally {
  await desktop?.close();
  await rm(tmp, { recursive: true, force: true });
}
