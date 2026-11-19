import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { installBrowserFixture, loginBrowserFixture } from './browser-fixture.mjs';

await mkdir('test-results', { recursive: true });
const url = process.env.VINQUETA_UI_URL || 'http://127.0.0.1:5174/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
try {
  // Bloqueia o React: o tema precisa estar correto antes de ele executar.
  const early = await browser.newPage({ colorScheme: 'dark' });
  await early.route(/\/src\/main\.tsx(?:\?|$)/, route => route.abort());
  await early.goto(url);
  assert.equal(await early.locator('html').getAttribute('data-theme'), 'dark');
  await early.evaluate(() => localStorage.setItem('vinqueta.theme', 'light'));
  await early.reload();
  assert.equal(await early.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await early.locator('#root').innerHTML(), '');
  await early.close();

  const page = await browser.newPage({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await installBrowserFixture(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('heading', { name: 'Acesso de fornecedor', exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await loginBrowserFixture(page);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: /Seguir o sistema/ }).isChecked(), true);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.getByRole('radio', { name: /^Escuro/ }).check();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'A escolha manual prevalece sobre o SO');
  await page.reload();
  await loginBrowserFixture(page);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: /^Escuro/ }).isChecked(), true);

  async function verify(screen, theme, width) {
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow ${screen}/${theme}/${width}`);
    // Verifica texto real renderizado, inclusive legendas, campos e botões.
    const failures = await page.evaluate(() => {
      function rgba(value) { return (value.match(/[\d.]+/g) || []).map(Number); }
      function blend(fg, bg) {
        const a = fg[3] ?? 1;
        return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1);
      }
      function background(el) {
        if (!el) return [255, 255, 255, 1];
        const color = rgba(getComputedStyle(el).backgroundColor);
        return (color[3] ?? 1) === 1 ? color : blend(color, background(el.parentElement));
      }
      function luminance(rgb) {
        const c = rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
      }
      const failures = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, el = node.parentElement;
        if (!node.textContent.trim() || !el || el.closest('script, style, .sr-only, :disabled')) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.top >= innerHeight) continue;
        const style = getComputedStyle(el), bg = background(el);
        const fg = blend(rgba(style.color), bg);
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
        const ratio = (hi + .05) / (lo + .05);
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) failures.push({ text: node.textContent.trim().slice(0, 60), ratio: ratio.toFixed(2) });
      }
      return failures;
    });
    assert.deepEqual(failures, [], `Contraste ${screen}/${theme}/${width}`);
    await page.screenshot({ path: `test-results/theme-${theme}-${screen}-${width}.png` });
  }
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: 'Configurações', exact: true }).click();
      await page.getByRole('radio', { name: theme === 'dark' ? /^Escuro/ : /^Claro/ }).check();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await verify('settings', theme, width);
      await page.reload();
      await page.getByRole('heading', { name: 'Acesso de fornecedor', exact: true }).waitFor();
      await verify('login', theme, width);
      await loginBrowserFixture(page);
      await page.getByRole('button', { name: 'Pedidos', exact: true }).click();
      await verify('orders', theme, width);
      await page.getByRole('button', { name: 'Etiquetas de preço', exact: true }).click();
      await page.getByLabel('Produto dos modelos').selectOption('exemplo-a');
      await verify('prices', theme, width);
      await page.getByLabel('Nome do produto', { exact: true }).scrollIntoViewIfNeeded();
      await verify('price-editor', theme, width);
      await page.getByRole('button', { name: /Lotes salvos/ }).click();
      await verify('history', theme, width);
    }
    console.log(`PASS temas ${width}px: configurações, login, pedidos, preços e histórico; contraste verificado.`);
  }
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('radio', { name: /Seguir o sistema/ }).check();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.deepEqual(errors, []);
  const unavailable = await browser.newPage();
  await installBrowserFixture(unavailable);
  await unavailable.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Indisponível'); };
    Storage.prototype.setItem = () => { throw new Error('Indisponível'); };
  });
  await unavailable.goto(url);
  await loginBrowserFixture(unavailable);
  await unavailable.getByRole('button', { name: 'Configurações', exact: true }).click();
  await unavailable.getByRole('radio', { name: /^Escuro/ }).check();
  await unavailable.getByText(/Não foi possível salvar a preferência/).waitFor();
  console.log('PASS preferência do SO ao vivo, override manual, reload, bootstrap anterior ao React e armazenamento indisponível.');
} finally { await browser.close(); }
