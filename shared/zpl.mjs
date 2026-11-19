// Ajuste de posição. Não redimensiona QR, fontes ou códigos.
export const MARKER_TEXT = 'Colar esta linha na quina da caixa com o codigo QR para cima';
export const Y_OFFSET_DOTS = 30;

export function parseZplToListOfLines(zpl) {
  const normalized = zpl.replace(/\r\n/g, '\n').trim();
  return (normalized.match(/\^XA[\s\S]*?\^XZ/g) ?? []).map(block =>
    block.split('\n').map(line => line.trim()).filter(Boolean));
}

export function subtractYAfterInstruction(labels, eixoYDots) {
  return labels.map(label => {
    let started = false;
    return label.map(line => {
      if (line.includes(MARKER_TEXT)) started = true;
      if (!started) return line;
      return line.replace(/\^FT(\d+),(\d+)/g, (_, x, y) =>
        `^FT${x},${Math.max(0, Number(y) - eixoYDots)}`)
        .replace(/\^FO(\d+),(\d+)/g, (_, x, y) =>
          `^FO${x},${Math.max(0, Number(y) - eixoYDots)}`);
    });
  });
}

export function labelsToZplString(labels) {
  return labels.map(label => label.join('\n')).join('\n');
}

export function transformZpl(zpl) {
  return labelsToZplString(subtractYAfterInstruction(parseZplToListOfLines(zpl), Y_OFFSET_DOTS));
}

function fieldData(zpl) {
  return [...zpl.matchAll(/\^FD([\s\S]*?)\^FS/g)].map(match => match[1]);
}

// O transformador original permanece acima. Estas validações adicionais falham
// fechadas para não eliminar blocos incompletos ou exportar outro layout sem ajuste.
export function processVolumeZpl(zpl) {
  if (typeof zpl !== 'string' || Buffer.byteLength(zpl, 'utf8') > 32 * 1024 * 1024)
    throw new Error('ZPL inválido ou maior que 32 MB.');
  const labels = parseZplToListOfLines(zpl);
  if (!labels.length) throw new Error('Nenhuma etiqueta ZPL completa foi encontrada.');
  if (labels.length !== (zpl.match(/\^XA/g) ?? []).length ||
      labels.length !== (zpl.match(/\^XZ/g) ?? []).length)
    throw new Error('O arquivo contém etiquetas incompletas. Nada foi liberado.');
  if (zpl.replace(/\^XA[\s\S]*?\^XZ/g, '').trim())
    throw new Error('Há conteúdo fora dos blocos ZPL. Revise o arquivo original.');
  for (const [i, label] of labels.entries()) {
    if (label.filter(line => line.includes(MARKER_TEXT)).length !== 1)
      throw new Error(`Etiqueta ${i + 1}: a linha de referência não foi encontrada uma única vez.`);
  }
  const output = transformZpl(zpl);
  if (JSON.stringify(fieldData(zpl)) !== JSON.stringify(fieldData(output)))
    throw new Error('A validação detectou alteração nos dados das etiquetas.');
  return {
    zpl: output, count: labels.length, offset: Y_OFFSET_DOTS,
    identifiers: [...output.matchAll(/\^FDQA,([^^]+)\^FS/g)].map(m => m[1]),
  };
}
