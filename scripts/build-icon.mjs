import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch(process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH, headless: true }
  : { channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><head><style>body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style></head><body>${await readFile('public/vinqueta.svg', 'utf8')}</body></html>`);
  await page.screenshot({ path: 'build/icon.png', omitBackground: true });
} finally { await browser.close(); }
