import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { installBrowserFixture, loginBrowserFixture } from './browser-fixture.mjs';

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await installBrowserFixture(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(process.env.VINQUETA_UI_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow ${width}`);
    assert.equal(await page.getByRole('navigation').count(), 0);
    assert.equal(await page.getByLabel('Senha', { exact: true }).getAttribute('type'), 'password');
    await page.screenshot({ path: `test-results/interface-${width}.png`, fullPage: true });
    await loginBrowserFixture(page);
    await page.getByRole('button', { name: 'Etiquetas de preço', exact: true }).click();
    await page.getByLabel('Produto dos modelos').selectOption('exemplo-a');
    await page.getByLabel('Quantidade de etiquetas').fill('4');
    await page.getByRole('button', { name: 'Adicionar ao lote' }).click();
    const layoutBefore = await page.evaluate(() => ({
      sidebar: document.querySelector('.sidebar').getBoundingClientRect().toJSON(),
      topbar: document.querySelector('.topbar').getBoundingClientRect().toJSON(),
    }));
    await page.locator('.content').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const layoutAfter = await page.evaluate(() => ({
      sidebar: document.querySelector('.sidebar').getBoundingClientRect().toJSON(),
      topbar: document.querySelector('.topbar').getBoundingClientRect().toJSON(),
    }));
    assert.deepEqual(layoutAfter, layoutBefore, `Navegação deve ficar fixa a ${width}px`);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.locator('.content').evaluate(element => { element.scrollTop = 0; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow preços ${width}`);
    await page.getByRole('button', { name: /Lotes salvos/ }).click();
    await page.getByRole('button', { name: 'Etiquetas de preço', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Remover Produto de exemplo A' }).count(), 1);
    await page.screenshot({ path: `test-results/precos-${width}.png`, fullPage: true });
    console.log(`PASS UI ${width}px: sem overflow; navegação liberada somente após login simulado.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
