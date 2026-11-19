// Coordenadas do perfil 33x22 / SEM-PARCELAS / COM-EAN.
// Não há ^BC ou QR nesses modelos: o EAN é impresso como texto.
export const PRICE_PROFILE = Object.freeze({
  id: 'price-33x22-3col', widthDots: 880, heightDots: 200, columns: 3,
  nominalSize: '33 × 22 mm', version: 1,
});
export const MAX_PRICE_LABELS = 100000;
export class PriceFieldError extends Error {
  /** @param {'name' | 'ean' | 'price' | 'quantity'} field @param {string} message */
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

export function parsePriceCents(input) {
  if (typeof input !== 'string' || !/^\d{1,3}(?:[,.]\d{2})?$/.test(input.trim()))
    throw new PriceFieldError('price', 'Informe um preço de R$ 0,01 a R$ 999,99, por exemplo 49,99. Sem separador de milhar.');
  const [reais, cents = '00'] = input.trim().replace('.', ',').split(',');
  const value = Number(reais) * 100 + Number(cents);
  if (value < 1 || value > 99999) throw new PriceFieldError('price', 'O modelo aceita preços de R$ 0,01 a R$ 999,99.');
  return value;
}

export function isValidEan13(ean) {
  if (typeof ean !== 'string' || !/^\d{13}$/.test(ean)) return false;
  const sum = [...ean.slice(0, 12)].reduce((total, c, i) => total + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(ean[12]);
}

export function validatePriceItem(input) {
  if (!input || typeof input !== 'object') throw new Error('Produto inválido.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 160 || /[\x00-\x1f]/.test(name))
    throw new PriceFieldError('name', 'Informe um nome de produto com até 160 caracteres.');
  const ean = typeof input.ean === 'string' ? input.ean.trim() : '';
  if (!isValidEan13(ean)) throw new PriceFieldError('ean', 'Informe um EAN-13 válido, incluindo o dígito verificador.');
  const cents = parsePriceCents(input.price);
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_PRICE_LABELS)
    throw new PriceFieldError('quantity', `A quantidade deve ser um inteiro de 1 a ${MAX_PRICE_LABELS}.`);
  let source;
  if (input.source !== undefined) {
    const s = input.source;
    if (!s || s.kind !== 'integration' || !/^\d{4}-\d+(?:-\d+)?$/.test(s.order) ||
        !/^[a-f0-9]{64}$/.test(s.sha256) || typeof s.version !== 'string' || s.version.length > 64 ||
        typeof s.productCode !== 'string' || s.productCode.length > 32 ||
        typeof s.variationCode !== 'string' || s.variationCode.length > 32)
      throw new Error('Origem da integração inválida.');
    source = { kind: 'integration', order: s.order, version: s.version, sha256: s.sha256, productCode: s.productCode, variationCode: s.variationCode };
  }
  return { name, ean, cents, quantity: input.quantity, ...(source ? { source } : {}) };
}

function column(ean, reais, cents, index) {
  const x = [12, 302, 582][index];
  const threeDigits = reais.length === 3;
  // Offsets assimétricos preservados: 290 dots entre colunas 1/2 e 280 entre 2/3.
  return `^FX COLUNA ${index + 1}
^FO${x},20^A0N,20,20^FD${ean}^FS
^FO${x},50^A0N,42,36^FDR$^FS
^FO${x + (threeDigits ? 48 : 63)},46^A0N,150,${threeDigits ? 65 : 80}^FD${reais}^FS
^FO${x + 142},50^A0N,60,50^FD,${cents}^FS`;
}

function row(ean, reais, cents, occupiedColumns, repetitions) {
  const columns = Array.from({ length: occupiedColumns }, (_, i) => column(ean, reais, cents, i));
  return `^XA
^CI28
^LH0,0
^PW880
^LL200

${columns.join('\n\n')}

^PQ${repetitions}
^XZ`;
}

export function generatePriceZpl(input) {
  const item = validatePriceItem(input);
  const reais = String(Math.floor(item.cents / 100));
  const cents = String(item.cents % 100).padStart(2, '0');
  const fullRows = Math.floor(item.quantity / 3), remainder = item.quantity % 3;
  const blocks = [];
  // ^PQ repete fileiras, não etiquetas individuais. A última fileira é parcial.
  if (fullRows) blocks.push(row(item.ean, reais, cents, 3, fullRows));
  if (remainder) blocks.push(row(item.ean, reais, cents, remainder, 1));
  return {
    zpl: blocks.join('\n'), count: item.quantity, rows: Math.ceil(item.quantity / 3),
    blankSlots: remainder ? 3 - remainder : 0, profile: PRICE_PROFILE.id,
    item, price: `${reais},${cents}`,
  };
}
