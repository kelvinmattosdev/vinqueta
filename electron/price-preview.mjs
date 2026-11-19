import { createHash } from 'node:crypto';
import { generatePriceZpl } from '../shared/price.mjs';

const DPI = { 6: 152, 8: 203, 12: 300, 24: 600 };
const MAX_PNG = 10 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class PricePreviewRenderer {
  constructor(fetcher = fetch) { this.fetcher = fetcher; this.cache = new Map(); }
  async render({ item, dpmm = 8, canvas = 'strip', row = 'first', consent } = {}) {
    if (consent !== true) throw new Error('Autorize o envio do EAN e do preço ao Labelary para renderizar.');
    if (![6, 8, 12, 24].includes(dpmm) || !['strip', '4x6'].includes(canvas) || !['first', 'last'].includes(row))
      throw new Error('Configuração de prévia inválida.');
    const generated = generatePriceZpl(item);
    const blocks = generated.zpl.match(/\^XA[\s\S]*?\^XZ/g);
    // A prévia mostra uma fileira, sem enviar milhares de repetições ao serviço.
    // Não altera a geometria, os ^FD ou o ZPL armazenado/exportado para impressão.
    const zpl = blocks[row === 'last' ? blocks.length - 1 : 0].replace(/\^PQ\d+/, '^PQ1');
    const dpi = DPI[dpmm];
    const width = canvas === '4x6' ? 4 : 880 / dpi;
    const height = canvas === '4x6' ? 6 : 200 / dpi;
    // Arredonda para cima para não recortar um dot na conversão para polegadas.
    const inches = n => String(Math.ceil(n * 1e6) / 1e6);
    const url = `https://api.labelary.com/v1/printers/${dpmm}dpmm/labels/${inches(width)}x${inches(height)}/0/`;
    const key = createHash('sha256').update(url).update(zpl).digest('hex');
    if (this.cache.has(key)) return this.cache.get(key);
    let response;
    try {
      response = await this.fetcher(url, {
        method: 'POST', headers: { Accept: 'image/png', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: zpl, redirect: 'error', signal: AbortSignal.timeout(20000),
      });
    } catch { throw new Error('Não foi possível acessar o Labelary. O ZPL e a geração local continuam disponíveis.'); }
    if (response.status === 429) throw new Error('O Labelary atingiu seu limite de consultas. Aguarde e tente manualmente.');
    if (!response.ok) throw new Error(`O Labelary não renderizou a prévia (HTTP ${response.status}).`);
    if (response.headers.get('content-type')?.split(';')[0].trim() !== 'image/png')
      throw new Error('O Labelary não retornou uma imagem PNG.');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_PNG) throw new Error('A imagem da prévia excede 10 MB.');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    const png = Buffer.concat(chunks);
    if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
        png.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Imagem de prévia inválida.');
    const pixelWidth = png.readUInt32BE(16), pixelHeight = png.readUInt32BE(20);
    if (!pixelWidth || !pixelHeight || pixelWidth * pixelHeight > 10_000_000)
      throw new Error('Dimensões da prévia inválidas.');
    const result = { image: `data:image/png;base64,${png.toString('base64')}`, pixelWidth, pixelHeight, dpi, canvas, row };
    if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, result);
    return result;
  }
}
