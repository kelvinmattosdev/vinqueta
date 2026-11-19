import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseIntegrationXml, readIntegrationBuffer } from '../electron/integration.mjs';
import { generatePriceZpl } from '../shared/price.mjs';
import { integrationBytes, integrationXml } from './integration-fixture.mjs';

test('importa ISO-8859-1 sem perder acentos; usa venda, não custo, e peças, não caixas', () => {
  const result = parseIntegrationXml(integrationBytes(), 'teste.xml');
  assert.equal(result.order, '2026-12345');
  assert.equal(result.standard, '1.4');
  assert.equal(result.rows[0].name, 'Vara de pesca ação rápida & molinete');
  assert.equal(result.rows[0].price, '199,99');
  assert.equal(result.rows[0].quantity, 1200);
  assert.equal(result.rows[0].ean, '1234567890128');
  assert.equal(result.rows[0].issue, null);
  assert.equal(result.rows[0].name.includes('Não executar'), false);
});
test('arquivo pertence ao pedido escolhido; não substitui silenciosamente por outro', () => {
  assert.throws(() => parseIntegrationXml(integrationBytes(), 'teste.xml', '2026-99999'), /não corresponde/);
});
test('DTD, entidades, XML inválido e raiz incorreta são bloqueados', () => {
  for (const invalid of [
    '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><OrdemCompra/>',
    '<OrdemCompra><Item></OrdemCompra>', '<html>login</html>',
  ]) assert.throws(() => parseIntegrationXml(Buffer.from(invalid)));
});
test('preço ausente, EAN errado e quantidade fracionária ficam visíveis mas bloqueados', () => {
  for (const xml of [
    integrationXml.replace('<PrecoVenda>199,99</PrecoVenda>', ''),
    integrationXml.replace('1234567890128', '1234567890120'),
    integrationXml.replace('>1200</QuantidadePrimariaTotalSolicitada>', '>1,5</QuantidadePrimariaTotalSolicitada>'),
  ]) assert.ok(parseIntegrationXml(Buffer.from(xml, 'latin1')).rows[0].issue);
});
test('soma divergente gera aviso e não é redistribuída automaticamente', () => {
  const xml = integrationXml.replace('>1200</QuantidadeTotalItem>', '>2400</QuantidadeTotalItem>');
  assert.match(parseIntegrationXml(Buffer.from(xml, 'latin1')).warnings[0], /soma/);
});
test('ZIP é lido em memória, exige um XML e não extrai scripts ou arquivos no disco', async () => {
  const zip = new JSZip(); zip.file('pasta/pedido.xml', integrationBytes()); zip.file('ignorar.exe', 'inofensivo');
  const result = await readIntegrationBuffer(await zip.generateAsync({ type: 'nodebuffer' }), 'pedido.zip');
  assert.equal(result.rows[0].quantity, 1200);
  zip.file('outro.xml', integrationBytes());
  await assert.rejects(readIntegrationBuffer(await zip.generateAsync({ type: 'nodebuffer' }), 'pedido.zip'), /exatamente um XML/);
});
test('origem XML é mantida na geração de preço, sem alterar os campos impressos', () => {
  const result = parseIntegrationXml(integrationBytes());
  const input = { ...result.rows[0], source: { kind: 'integration', order: result.order, version: result.version,
    sha256: result.sha256, productCode: '123', variationCode: '1' } };
  const output = generatePriceZpl(input);
  assert.equal(output.item.source.order, result.order);
  assert.equal(output.count, 1200);
  assert.match(output.zpl, /\^PQ400/);
  assert.doesNotMatch(output.zpl, /OrdemCompra|Não executar|89,73/);
});
