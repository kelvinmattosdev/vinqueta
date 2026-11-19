import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKER_TEXT, transformZpl, processVolumeZpl } from '../shared/zpl.mjs';

import { sample } from './fixture.mjs';

test('preserva QR e desloca o marcador e tudo abaixo em 30 dots', () => {
  const result = processVolumeZpl(sample);
  assert.equal(result.count, 1);
  assert.match(result.zpl, /\^FT290,370/);
  assert.match(result.zpl, /\^FT20,470/);
  assert.match(result.zpl, /\^FO20,510/);
  assert.match(result.zpl, /\^FT020,970/);
  assert.match(result.zpl, /\^FT25,1125/);
  assert.deepEqual(result.identifiers, ['300000000000000000000001']);
});
test('processa todos os blocos e normaliza CRLF como o script original', () => {
  assert.equal(processVolumeZpl((sample + '\r\n' + sample).replace(/\n/g, '\r\n')).count, 2);
});
test('bloqueia blocos incompletos, layout sem marcador e conteúdo externo', () => {
  assert.throws(() => processVolumeZpl(sample + '\n^XA'));
  assert.throws(() => processVolumeZpl(sample.replace(MARKER_TEXT, 'outro layout')));
  assert.throws(() => processVolumeZpl('texto\n' + sample));
  assert.throws(() => processVolumeZpl(''));
});
test('a transformação original limita Y a zero', () => {
  assert.match(transformZpl(sample.replace('^FO20,540', '^FO20,10')), /\^FO20,0/);
});
