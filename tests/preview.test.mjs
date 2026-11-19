import test from 'node:test';
import assert from 'node:assert/strict';
import { PricePreviewRenderer } from '../electron/price-preview.mjs';
import { generatePriceZpl } from '../shared/price.mjs';

// PNG de 1px usado apenas para testar o transporte; não simula fidelidade visual.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const item = { name: 'Produto de teste', ean: '1234567890128', price: '349,90', quantity: 100000 };
const options = { item, dpmm: 8, canvas: 'strip', row: 'first', consent: true };
const reply = () => new Response(png, { headers: { 'Content-Type': 'image/png' } });

test('nenhuma consulta sem consentimento ou com entrada inválida', async () => {
  let calls = 0;
  const renderer = new PricePreviewRenderer(async () => { calls++; return reply(); });
  await assert.rejects(renderer.render({ ...options, consent: false }), /Autorize/);
  await assert.rejects(renderer.render({ ...options, dpmm: 999 }));
  await assert.rejects(renderer.render({ ...options, item: { ...item, ean: '^XA' } }));
  assert.equal(calls, 0);
});
test('envia ZPL real em POST, sem credenciais e sem alterar o arquivo de impressão', async () => {
  const original = generatePriceZpl(item).zpl;
  const calls = [];
  const renderer = new PricePreviewRenderer(async (url, request) => { calls.push({ url, request }); return reply(); });
  const result = await renderer.render(options);
  assert.equal(result.image, `data:image/png;base64,${png.toString('base64')}`);
  assert.match(calls[0].url, /^https:\/\/api\.labelary\.com\/v1\/printers\/8dpmm\/labels\//);
  assert.equal(calls[0].request.method, 'POST');
  assert.equal(calls[0].request.body, original.match(/\^XA[\s\S]*?\^XZ/)[0].replace(/\^PQ\d+/, '^PQ1'));
  assert.deepEqual(Object.keys(calls[0].request.headers).sort(), ['Accept', 'Content-Type']);
  assert.equal(generatePriceZpl(item).zpl, original);
  assert.match(original, /\^PQ33333/);
  await renderer.render(options);
  assert.equal(calls.length, 1, 'prévia idêntica usa cache em memória');
});
test('última fileira parcial e papel 4x6 são renderizados sem HTML', async () => {
  let url, body;
  const renderer = new PricePreviewRenderer(async (u, r) => { url = u; body = r.body; return reply(); });
  await renderer.render({ ...options, item: { ...item, quantity: 5 }, row: 'last', canvas: '4x6', dpmm: 12 });
  assert.equal(url, 'https://api.labelary.com/v1/printers/12dpmm/labels/4x6/0/');
  assert.equal((body.match(/\^FDR\$/g) || []).length, 2);
  assert.match(body, /\^FO60,46\^A0N,150,65\^FD349/);
});
test('rejeita HTML/PNG inválido e limites de consulta, sem retry', async () => {
  for (const response of [new Response('<html>erro</html>'), new Response('não é PNG', { headers: { 'Content-Type': 'image/png' } }), new Response('', { status: 429 })]) {
    let calls = 0;
    const renderer = new PricePreviewRenderer(async () => { calls++; return response; });
    await assert.rejects(renderer.render(options));
    assert.equal(calls, 1);
  }
});
