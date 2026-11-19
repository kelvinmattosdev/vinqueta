import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { generatePriceZpl, parsePriceCents, isValidEan13 } from '../shared/price.mjs';
import { pricePresets } from '../shared/price-presets.mjs';
import { JobStore } from '../electron/jobs.mjs';
import JSZip from 'jszip';
import { sample } from './fixture.mjs';

const input = { name: 'Produto', ean: '2000000000015', price: '199,99', quantity: 3 };
test('layout de três dígitos coincide com o exemplo de referência', async () => {
  const example = await readFile(new URL('./fixtures/price-3digits.txt', import.meta.url), 'utf8');
  assert.equal(generatePriceZpl(input).zpl, example.trim());
});
test('layout de dois dígitos coincide com o exemplo de referência', async () => {
  const example = await readFile(new URL('./fixtures/price-2digits.txt', import.meta.url), 'utf8');
  assert.equal(generatePriceZpl({ ...input, ean: '2000000000022', price: '99,99' }).zpl, example.trim());
});
test('preços são calculados em centavos inteiros, sem arredondamento binário', () => {
  for (const [text, value] of [['49,99', 4999], ['349,90', 34990], ['100', 10000], ['0,01', 1], ['9.00', 900]])
    assert.equal(parsePriceCents(text), value);
  for (const invalid of ['0', '1000,00', '1.000,00', '49,9', 'R$ 49,99', '-1,00', '99^XZ', 49.99])
    assert.throws(() => parsePriceCents(invalid));
});
test('EANs dos exemplos fictícios são válidos, injeções e verificador errado são bloqueados', () => {
  for (const p of pricePresets) assert.equal(isValidEan13(p.ean), true);
  assert.equal(isValidEan13('2000000000010'), false);
  assert.throws(() => generatePriceZpl({ ...input, ean: '789^XA' }));
  assert.throws(() => generatePriceZpl({ ...input, quantity: 1.5 }));
  assert.throws(() => generatePriceZpl({ ...input, quantity: 100001 }));
});
test('quantidade é de etiquetas, ^PQ repete fileiras e não cria excedentes', () => {
  for (const quantity of [1, 2, 3, 4, 5, 6, 7, 100, 99999, 100000]) {
    const result = generatePriceZpl({ ...input, quantity });
    let printed = 0;
    for (const block of result.zpl.match(/\^XA[\s\S]*?\^XZ/g)) {
      const columns = (block.match(/\^FDR\$/g) || []).length;
      printed += columns * Number(block.match(/\^PQ(\d+)/)[1]);
    }
    assert.equal(printed, quantity);
    assert.equal(result.rows, Math.ceil(quantity / 3));
    assert.equal(result.blankSlots, (3 - quantity % 3) % 3);
  }
});
test('centavos ,90 e ,00 são preservados, sem barcode ou deslocamento de volume', () => {
  const result = generatePriceZpl({ ...input, price: '349,90' });
  assert.match(result.zpl, /\^FD,90\^FS/);
  assert.match(generatePriceZpl({ ...input, price: '99,00' }).zpl, /\^FD,00\^FS/);
  assert.match(result.zpl, /\^FO12,20/);
  assert.doesNotMatch(result.zpl, /\^BC|\^BQ|Colar esta linha/);
});
test('lotes de preços exportam TXT ou ZIP e convivem com os lotes de volume', async () => {
  const directory = await mkdtemp('/tmp/opencode/vinqueta-prices-');
  try {
    const store = new JobStore(directory);
    const one = await store.savePrices([input]);
    assert.equal(one.count, 3);
    assert.equal(one.offset, 0);
    assert.equal(one.kind, 'price');
    assert.match((await store.archive(one.id)).buffer.toString(), /\^FO12,20/);
    const batch = await store.savePrices([input, { ...input, quantity: 4, price: '99,90' }]);
    assert.equal(batch.count, 7);
    assert.equal(batch.rows, 3);
    const archive = await store.archive(batch.id);
    const zip = await JSZip.loadAsync(archive.buffer);
    assert.equal(Object.values(zip.files).filter(f => !f.dir).length, 2);
    assert.equal((await store.list()).length, 2);
    const volume = await store.save([{ name: 'volume.txt', zpl: sample }], 'Volume');
    assert.equal((await store.list()).length, 3);
    assert.equal((await store.load(volume.id)).job.offset, 30);
    await assert.rejects(store.savePrices([{ ...input, price: '1000' }]));
    await assert.rejects(store.savePrices([{ ...input, quantity: 100000 }, input]));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
