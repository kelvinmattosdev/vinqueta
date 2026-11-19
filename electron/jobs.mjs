import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import JSZip from 'jszip';
import { processVolumeZpl } from '../shared/zpl.mjs';
import { generatePriceZpl, MAX_PRICE_LABELS, PRICE_PROFILE } from '../shared/price.mjs';

const MAX = 32 * 1024 * 1024;
const digest = text => createHash('sha256').update(text).digest('hex');

export class JobStore {
  constructor(directory) { this.directory = directory; }
  async save(originals, label) {
    const id = randomUUID();
    const dir = join(this.directory, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const files = [];
    // Grava os originais antes de transformar: uma falha não obriga gerar de novo.
    for (let i = 0; i < originals.length; i++) {
      const original = originals[i];
      await writeFile(join(dir, `${i}.original.zpl`), original.zpl, { mode: 0o600 });
    }
    for (let i = 0; i < originals.length; i++) {
      const original = originals[i];
      const result = processVolumeZpl(original.zpl);
      const name = `${i + 1}-${basename(original.name, extname(original.name)).replace(/[^a-zA-Z0-9 _.-]/g, '_')}-atualizado.txt`;
      await writeFile(join(dir, `${i}.processed.zpl`), result.zpl, { mode: 0o600 });
      files.push({ name, count: result.count, hash: digest(result.zpl) });
    }
    const job = { id, label, date: new Date().toISOString(), files,
      count: files.reduce((s, f) => s + f.count, 0), offset: 30, kind: 'volume' };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(job), { mode: 0o600 });
    return job;
  }
  async savePrices(inputs) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100)
      throw new Error('Adicione de 1 a 100 produtos ao lote de preços.');
    // Valida todo o lote antes de escrever qualquer arquivo.
    const generated = inputs.map(generatePriceZpl);
    const count = generated.reduce((total, result) => total + result.count, 0);
    if (count > MAX_PRICE_LABELS) throw new Error(`O lote excede ${MAX_PRICE_LABELS} etiquetas.`);
    const id = randomUUID(), dir = join(this.directory, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const files = [];
    for (const [i, result] of generated.entries()) {
      const safeName = result.item.name.replace(/[^a-zA-Z0-9 _.-]/g, '_');
      const name = `${i + 1}-${safeName}-${result.price}-33x22.txt`;
      await writeFile(join(dir, `${i}.processed.zpl`), result.zpl, { mode: 0o600, flag: 'wx' });
      files.push({ name, count: result.count, rows: result.rows, blankSlots: result.blankSlots,
        hash: digest(result.zpl), product: result.item.name, ean: result.item.ean, price: result.price,
        ...(result.item.source ? { source: result.item.source } : {}) });
    }
    const job = { id, kind: 'price', label: generated.length === 1 ? generated[0].item.name : `Preços · ${generated.length} produtos`,
      date: new Date().toISOString(), files, count, offset: 0, profile: PRICE_PROFILE.id,
      rows: generated.reduce((total, r) => total + r.rows, 0) };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(job), { mode: 0o600, flag: 'wx' });
    return job;
  }
  async list() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const jobs = [];
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
      try { jobs.push((await this.load(entry.name)).job); } catch { /* Incompletos não são liberados. */ }
    }
    return jobs.sort((a, b) => b.date.localeCompare(a.date));
  }
  async load(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Lote inválido.');
    const dir = join(this.directory, id);
    const job = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    const validKind = job.kind === 'price' ?
      job.offset === 0 && job.profile === PRICE_PROFILE.id :
      (job.kind === undefined || job.kind === 'volume') && job.offset === 30;
    if (job.id !== id || !validKind || !Array.isArray(job.files) || !job.files.length) throw new Error('Lote inválido.');
    const files = [];
    for (const [i, f] of job.files.entries()) {
      const zpl = await readFile(join(dir, `${i}.processed.zpl`), 'utf8');
      if (digest(zpl) !== f.hash) throw new Error('O lote foi alterado no disco. A saída foi bloqueada.');
      files.push({ name: f.name, zpl });
    }
    return { job, files };
  }
  async archive(id) {
    const { job, files } = await this.load(id);
    if (files.length === 1) return { buffer: Buffer.from(files[0].zpl, 'utf8'), name: files[0].name };
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.zpl);
    return { buffer: await zip.generateAsync({ type: 'nodebuffer' }),
      name: `${job.id}-${job.kind === 'price' ? 'precos-33x22' : 'atualizado'}.zip` };
  }
}

export async function readImport(path) {
  if (/-atualizado$/i.test(basename(path, extname(path))))
    throw new Error('Este nome indica um arquivo já ajustado. Importe o original para não deslocá-lo duas vezes.');
  const buffer = await readFile(path);
  if (buffer.length > MAX) throw new Error('O arquivo excede 32 MB.');
  if (extname(path).toLowerCase() !== '.zip')
    return [{ name: basename(path), zpl: new TextDecoder('utf-8', { fatal: true }).decode(buffer) }];
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  const entries = Object.values(zip.files).filter(f => !f.dir);
  if (entries.length > 200) throw new Error('O ZIP excede o limite de 200 arquivos.');
  let total = 0;
  const originals = [];
  for (const entry of entries) {
    if (!/\.(txt|zpl)$/i.test(entry.name)) continue;
    if (/-atualizado\.(txt|zpl)$/i.test(entry.name)) throw new Error('O ZIP contém arquivos já ajustados.');
    const size = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size < 0 || (total += size) > MAX)
      throw new Error('O ZIP excede 32 MB descompactado.');
    const bytes = await entry.async('uint8array');
    if (bytes.length !== size) throw new Error('Tamanho inconsistente dentro do ZIP.');
    originals.push({ name: basename(entry.name), zpl: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
  }
  if (!originals.length) throw new Error('O ZIP não contém arquivos .txt ou .zpl.');
  return originals;
}
