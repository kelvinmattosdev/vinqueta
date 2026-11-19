import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { JobStore, readImport } from '../electron/jobs.mjs';
import { sample } from './fixture.mjs';

test('só exporta processado, verifica hash e mantém original de falha', async () => {
  const dir = await mkdtemp('/tmp/opencode/vinqueta-test-');
  try {
    const store = new JobStore(dir);
    const job = await store.save([{ name: 'caixa.txt', zpl: sample }], 'Teste');
    const archive = await store.archive(job.id);
    assert.match(archive.buffer.toString(), /\^FT25,1125/);
    assert.equal((await store.list()).length, 1);
    await writeFile(join(dir, job.id, '0.processed.zpl'), 'alterado');
    await assert.rejects(store.archive(job.id), /alterado/);
    await assert.rejects(store.load('../escape'));
    await assert.rejects(store.save([{ name: 'falha.txt', zpl: '^XA^XZ' }], 'falha'));
    assert.equal((await readdir(dir)).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('importa ZIP sem extrair caminhos e rejeita arquivos já ajustados', async () => {
  const dir = await mkdtemp('/tmp/opencode/vinqueta-zip-');
  try {
    const zip = new JSZip();
    zip.file('pasta/caixa.txt', sample);
    await writeFile(join(dir, 'original.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
    assert.equal((await readImport(join(dir, 'original.zip'))).length, 1);
    await writeFile(join(dir, 'caixa-atualizado.txt'), sample);
    await assert.rejects(readImport(join(dir, 'caixa-atualizado.txt')), /duas vezes/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
