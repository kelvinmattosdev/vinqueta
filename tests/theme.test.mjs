import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const lightBlock = css.match(/:root \{([\s\S]*?)\n\}/)[1];
const darkBlock = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1];
function palette(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})\s*;/gi)].map(m => [m[1], m[2]]));
}
const light = palette(lightBlock), dark = { ...light, ...palette(darkBlock) };
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (hi + .05) / (lo + .05);
}
test('todos os pares de texto e foco atendem WCAG AA nos dois temas', () => {
  const textPairs = [
    ...['page', 'surface', 'elevated', 'subtle', 'hover', 'workflow', 'active'].flatMap(bg => [['ink', bg], ['muted', bg]]),
    ...['surface', 'elevated', 'subtle', 'workflow', 'active'].map(bg => ['accent', bg]),
    ['on-primary', 'deep'], ['on-primary', 'primary-hover'], ['placeholder', 'elevated'],
    ['success-text', 'success-bg'], ['error-text', 'error-bg'], ['warning-text', 'warning-bg'],
    ['error-text', 'surface'], ['code-text', 'code-bg'], ['mint', 'brand-bg'], ['paper-ink', 'paper-bg'], ['paper-muted', 'paper-bg'],
  ];
  for (const [name, tokens] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of textPairs) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      assert(ratio >= 4.5, `${name}: ${fg}/${bg} = ${ratio.toFixed(2)}:1`);
    }
    for (const fg of ['focus', 'control-line']) for (const bg of ['surface', 'elevated', 'page']) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      assert(ratio >= 3, `${name}: ${fg}/${bg} = ${ratio.toFixed(2)}:1`);
    }
  }
  console.log(`Contraste: ${textPairs.length} pares de texto e 6 pares de foco/controles por tema.`);
});
test('cores da interface estão centralizadas em tokens; papel não é invertido', () => {
  const rules = css.replace(lightBlock, '').replace(darkBlock, '');
  assert.doesNotMatch(rules, /#[a-f\d]{3,8}\b/i);
  assert.equal(dark['paper-bg'], light['paper-bg']);
  assert.equal(dark['paper-ink'], light['paper-ink']);
  const defined = new Set([...css.matchAll(/--([\w-]+):/g)].map(m => m[1]));
  for (const match of css.matchAll(/var\(--([\w-]+)\)/g)) assert(defined.has(match[1]), match[1]);
});
test('bootstrap síncrono aplica preferência antes do React, com fallback seguro', async () => {
  const script = await readFile(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  for (const saved of [null, 'system', 'dark', 'light', 'inválido', 'unavailable']) for (const systemDark of [false, true]) {
    const root = { dataset: {}, style: {} }, meta = {};
    vm.runInNewContext(script, {
      document: { documentElement: root, querySelector: () => meta },
      localStorage: { getItem() { if (saved === 'unavailable') throw new Error('Indisponível'); return saved; } },
      matchMedia: () => ({ matches: systemDark }),
    });
    const expected = saved === 'light' ? 'light' : saved === 'dark' || systemDark ? 'dark' : 'light';
    assert.equal(root.dataset.theme, expected);
    assert.equal(root.style.colorScheme, expected);
    assert.equal(meta.content, expected === 'dark' ? '#151b18' : '#f3f3f3');
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/theme-init.js"><\/script>/);
  assert(html.indexOf('theme-init.js') < html.indexOf('<body>'));
});
