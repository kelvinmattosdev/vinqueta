import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createExtractorFromData } from 'node-unrar-js';
import JSZip from 'jszip';
import { validatePriceItem } from '../shared/price.mjs';

export const MAX_INTEGRATION_BYTES = 16 * 1024 * 1024;
const array = value => value == null || value === '' ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' ? value.trim() : '';
const sum = rows => rows.reduce((total, row) => total + row.quantity, 0);

export function decodeIntegrationXml(bytes) {
  const data = Buffer.from(bytes);
  if (data.length > MAX_INTEGRATION_BYTES) throw new Error('O XML excede 16 MB.');
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(data);
  const declaration = data.subarray(0, 256).toString('ascii');
  const encoding = declaration.match(/encoding\s*=\s*["']([^"']+)/i)?.[1]?.toLowerCase() || 'utf-8';
  const supported = { 'iso-8859-1': 'windows-1252', 'windows-1252': 'windows-1252', 'utf-8': 'utf-8', utf8: 'utf-8' };
  if (!supported[encoding]) throw new Error('A codificação do XML não é suportada.');
  try { return new TextDecoder(supported[encoding], { fatal: true }).decode(data); }
  catch { throw new Error('O arquivo não pôde ser lido na codificação declarada no XML.'); }
}

function integralQuantity(value) {
  const raw = text(value);
  if (!/^\d+(?:[,.]0+)?$/.test(raw)) throw new Error('Quantidade não inteira ou ausente no XML.');
  const quantity = Number(raw.replace(',', '.'));
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Quantidade inválida no XML.');
  return quantity;
}

export function parseIntegrationXml(bytes, sourceName = 'integração.xml', expectedOrder) {
  const xml = decodeIntegrationXml(bytes);
  // Não resolve DTD, entidades externas ou instruções contidas nos modelos.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML com DTD ou entidades personalizadas não é permitido.');
  if (XMLValidator.validate(xml) !== true) throw new Error('O XML de integração está malformado.');
  const parsed = new XMLParser({
    parseTagValue: false, parseAttributeValue: false, ignoreAttributes: false,
    trimValues: true, processEntities: true, allowBooleanAttributes: false,
  }).parse(xml);
  const root = parsed.OrdemCompra;
  if (!root || typeof root !== 'object') throw new Error('O arquivo não é uma integração Havan com raiz OrdemCompra.');
  const order = text(root.NumeroOrdemCompra);
  if (!/^\d{4}-\d+(?:-\d+)?$/.test(order)) throw new Error('O número da ordem de compra não é válido.');
  if (expectedOrder && order !== expectedOrder) throw new Error('O pedido dentro do XML não corresponde ao pedido selecionado no portal.');
  const items = array(root.ItensOrdemCompra?.ItemOrdemCompra);
  if (!items.length || items.length > 5000) throw new Error('O XML não contém itens ou excede o limite de 5.000 produtos.');
  const rows = [], warnings = [];
  for (const [itemIndex, item] of items.entries()) {
    const variations = array(item.DetalhamentoVariacoesItem?.VariacaoItem);
    if (!variations.length) warnings.push(`Produto ${itemIndex + 1}: não há variações com EAN; packs não são expandidos automaticamente.`);
    const currentRows = [];
    for (const [variationIndex, variation] of (variations.length ? variations : [{}]).entries()) {
      const name = text(item.DescricaoProduto), price = text(item.PrecoVenda);
      const quantityRaw = text(variation.QuantidadePrimariaTotalSolicitada);
      const row = {
        id: `${itemIndex}:${variationIndex}`, productCode: text(item.CodigoProduto),
        variationCode: text(variation.CodigoVariacao), variation: text(variation.DescricaoVariacaoCompleta),
        name, ean: text(variation.CodigoBarrasVariacao), price, quantity: 0,
        unit: text(variation.UnidadeMedidaPrimariaSolicitada), issue: null,
      };
      try {
        row.quantity = integralQuantity(quantityRaw);
        const validated = validatePriceItem(row);
        row.price = `${Math.floor(validated.cents / 100)},${String(validated.cents % 100).padStart(2, '0')}`;
      } catch (error) { row.issue = error.message; }
      if (row.unit && !['PC', 'UN', 'UND', 'PÇ', 'PÇS'].includes(row.unit.toUpperCase()))
        warnings.push(`Produto ${itemIndex + 1}, variação ${variationIndex + 1}: unidade ${row.unit}; confira a quantidade de etiquetas por unidade.`);
      currentRows.push(row);
      rows.push(row);
      if (rows.length > 5000) throw new Error('O XML excede o limite de 5.000 variações.');
    }
    const declaredTotal = text(item.QuantidadeTotalItem);
    if (declaredTotal && currentRows.every(r => !r.issue)) {
      try {
        if (integralQuantity(declaredTotal) !== sum(currentRows))
          warnings.push(`Produto ${itemIndex + 1}: a soma das quantidades por variação difere da quantidade total do item. Confira antes de gerar.`);
      } catch { warnings.push(`Produto ${itemIndex + 1}: o total declarado não é inteiro; confira as quantidades.`); }
    }
  }
  return {
    order, version: text(root.Versao), standard: text(root['@_Padrao']), sourceName: basename(sourceName),
    sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'), rows, warnings,
    total: sum(rows.filter(row => !row.issue)),
    priceField: 'PrecoVenda', quantityField: 'QuantidadePrimariaTotalSolicitada',
  };
}

function validateArchiveEntries(entries) {
  if (!entries.length || entries.length > 200) throw new Error('O arquivo compactado deve ter de 1 a 200 entradas.');
  let expanded = 0;
  for (const entry of entries) {
    if (/^[\\/]|^[A-Za-z]:|(?:^|[\\/])\.\.(?:[\\/]|$)/.test(entry.name))
      throw new Error('O arquivo compactado contém um caminho inseguro.');
    if (entry.encrypted) throw new Error('Integrações protegidas por senha não são suportadas.');
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || (expanded += entry.size) > 32 * 1024 * 1024)
      throw new Error('O arquivo compactado excede 32 MB descompactado.');
  }
  const xmlFiles = entries.filter(e => !e.directory && /\.xml$/i.test(e.name));
  if (xmlFiles.length !== 1 || xmlFiles[0].size > MAX_INTEGRATION_BYTES)
    throw new Error('Selecione um arquivo com exatamente um XML de até 16 MB, ou importe o XML diretamente.');
  return xmlFiles[0];
}

export async function readIntegrationBuffer(input, sourceName, expectedOrder) {
  const bytes = Buffer.from(input);
  if (bytes.length > MAX_INTEGRATION_BYTES) throw new Error('O arquivo de integração excede 16 MB.');
  let xml = bytes, xmlName = sourceName;
  if (bytes.subarray(0, 6).equals(Buffer.from('526172211a07', 'hex'))) {
    try {
      const extractor = await createExtractorFromData({ data: Uint8Array.from(bytes).buffer });
      const list = extractor.getFileList();
      if (list.arcHeader.flags.volume || list.arcHeader.flags.headerEncrypted)
        throw new Error('Integrações RAR multipartes ou criptografadas não são suportadas.');
      const headers = [...list.fileHeaders];
      const selected = validateArchiveEntries(headers.map(h => ({
        name: h.name, size: h.unpSize, directory: h.flags.directory, encrypted: h.flags.encrypted,
      })));
      const files = [...extractor.extract({ files: [selected.name] }).files];
      const extracted = files.find(file => file.fileHeader.name === selected.name)?.extraction;
      if (!extracted || extracted.byteLength !== selected.size) throw new Error('XML extraído com tamanho inconsistente.');
      xml = Buffer.from(extracted); xmlName = selected.name;
    } catch (error) {
      if (error instanceof Error && !error.reason) throw error;
      throw new Error('Não foi possível abrir o RAR. Importe o XML descompactado.');
    }
  } else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const archive = await JSZip.loadAsync(bytes);
    const selected = validateArchiveEntries(Object.values(archive.files).map(f => ({
      name: f.name, size: f.dir ? 0 : f._data?.uncompressedSize, directory: f.dir, encrypted: false,
    })));
    xml = await archive.file(selected.name).async('nodebuffer'); xmlName = selected.name;
    if (xml.length !== selected.size) throw new Error('XML extraído com tamanho inconsistente.');
  }
  const result = parseIntegrationXml(xml, xmlName, expectedOrder);
  return { ...result, archiveName: basename(sourceName) };
}

export async function readIntegrationFile(path) {
  if ((await stat(path)).size > MAX_INTEGRATION_BYTES) throw new Error('O arquivo excede 16 MB.');
  return readIntegrationBuffer(await readFile(path), basename(path));
}
