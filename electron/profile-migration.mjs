import { cp, lstat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Identificadores legados usados somente na atualização de instalações existentes.
export const LEGACY_PROFILE = 'jau-etiquetas';
export const LEGACY_VAULT_SCHEMA = 'br.com.jaupesca.etiquetas.SupplierAccess';
export const LEGACY_LAUNCHER_MARKER = '# Managed by Jaú Pesca Etiquetas installer';

export async function exists(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function migrateLegacyProfile(root, legacy) {
  const completed = join(root, '.perfil-v0');
  if (root === legacy || await exists(completed)) return;
  if (!(await exists(legacy))?.isDirectory()) return;
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const name of ['protocol.json', 'avisos.json', 'lotes', 'Local Storage']) {
    const source = join(legacy, name), destination = join(root, name);
    const entry = await exists(source);
    if (!entry || entry.isSymbolicLink() || await exists(destination)) continue;
    await cp(source, destination, { recursive: entry.isDirectory(), force: false, errorOnExist: true });
  }
  if ((await exists(join(legacy, 'acesso-salvo')))?.isFile() && !await exists(join(root, 'acesso-salvo'))) {
    await writeFile(join(root, 'acesso-legado'), '1', { mode: 0o600 });
  }
  await writeFile(completed, '1', { mode: 0o600 });
}
