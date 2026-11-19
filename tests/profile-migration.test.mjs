import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrateLegacyProfile, exists } from '../electron/profile-migration.mjs';

test('migração copia os dados conhecidos, não sobrescreve nem importa cookies', async t => {
  const base = await mkdtemp('/tmp/opencode/vinqueta-migration-');
  t.after(() => rm(base, { recursive: true, force: true }));
  const old = join(base, 'legacy'), root = join(base, 'vinqueta');
  await mkdir(join(old, 'lotes'), { recursive: true });
  await mkdir(join(old, 'Local Storage'), { recursive: true });
  await mkdir(root);
  await writeFile(join(old, 'protocol.json'), 'fictício');
  await writeFile(join(old, 'avisos.json'), 'versão antiga');
  await writeFile(join(root, 'avisos.json'), 'versão nova');
  await writeFile(join(old, 'lotes', 'teste'), 'lote fictício');
  await writeFile(join(old, 'Local Storage', 'teste'), 'tema fictício');
  await writeFile(join(old, 'acesso-salvo'), '1');
  await writeFile(join(old, 'Cookies'), 'não copiar');
  await migrateLegacyProfile(root, old);
  for (const [file, value] of [
    ['protocol.json', 'fictício'], ['avisos.json', 'versão nova'], ['lotes/teste', 'lote fictício'],
    ['Local Storage/teste', 'tema fictício'], ['acesso-legado', '1'],
  ]) assert.equal(await readFile(join(root, file), 'utf8'), value);
  assert.equal(await exists(join(root, 'Cookies')), null);
  assert.equal(await exists(join(root, 'acesso-salvo')), null);
  await rm(join(root, 'acesso-legado'));
  await migrateLegacyProfile(root, old);
  assert.equal(await exists(join(root, 'acesso-legado')), null);
  assert.equal(await readFile(join(old, 'lotes', 'teste'), 'utf8'), 'lote fictício');
});
