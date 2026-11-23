import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { findInstallTarget, installAppImage } from '../electron/update-install.mjs';

const newImage = Buffer.concat([Buffer.from('7f454c460201010041490200', 'hex'), Buffer.from('fixture')]);
const asset = {
  url: 'https://github.com/kelvinmattosdev/vinqueta/releases/download/v1.2.3/vinqueta-1.2.3-x86_64.AppImage',
  size: newImage.length,
  digest: createHash('sha256').update(newImage).digest('hex'),
};

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'vinqueta-updater-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

test('baixa via CDN oficial, verifica a imagem e troca o executável de uma vez', async t => {
  const base = await fixture(t);
  const file = join(base, 'Vinqueta.AppImage');
  await writeFile(file, 'app antigo');
  const visited = [], progress = [];
  const fetcher = async url => {
    visited.push(url.hostname);
    if (url.hostname === 'github.com') return Response.redirect('https://release-assets.githubusercontent.com/arquivo');
    return new Response(newImage);
  };
  assert.equal(await installAppImage({ file, local: false }, asset, (...info) => progress.push(info), { fetcher }), file);
  assert.deepEqual(await readFile(file), newImage);
  assert.deepEqual(await readdir(base), ['Vinqueta.AppImage']);
  assert.deepEqual(visited, ['github.com', 'release-assets.githubusercontent.com']);
  assert.deepEqual(progress.at(-1), ['restart', 100]);
});

test('falha de integridade ou redirecionamento externo preserva a instalação', async t => {
  const base = await fixture(t);
  const file = join(base, 'Vinqueta.AppImage');
  await writeFile(file, 'app antigo');
  const install = (metadata, fetcher) => installAppImage({ file, local: false }, metadata, () => {}, { fetcher });
  await assert.rejects(install({ ...asset, digest: '0'.repeat(64) }, async () => new Response(newImage)), /verificação/);
  await assert.rejects(install(asset, async url => {
    assert.equal(url.hostname, 'github.com');
    return Response.redirect('https://fora.example/download');
  }), /Origem/);
  assert.equal(await readFile(file, 'utf8'), 'app antigo');
  assert.deepEqual(await readdir(base), ['Vinqueta.AppImage']);
});

test('migra a instalação local mantendo o mesmo caminho do atalho', async t => {
  const home = await fixture(t);
  const directory = join(home, '.local/opt/vinqueta/1.0.0-12345');
  await mkdir(directory, { recursive: true });
  const executable = join(directory, 'vinqueta');
  await writeFile(executable, 'app existente');
  const target = await findInstallTarget({ packaged: true, executable, home });
  assert.deepEqual(target, { file: executable, local: true });
  assert.equal(await installAppImage(target, asset, () => {}, { fetcher: async () => new Response(newImage) }), executable);
  assert.match(await readFile(executable, 'utf8'), /^#!\/bin\/sh\nexec .*Vinqueta\.AppImage/);
  assert.deepEqual(await readFile(join(directory, 'Vinqueta.AppImage')), newImage);
});

test('não trata um .deb, um link simbólico ou um arquivo comum como AppImage', async t => {
  const home = await fixture(t);
  const ordinary = join(home, '.bashrc'), image = join(home, 'Vinqueta.AppImage');
  await writeFile(ordinary, 'não é um app');
  await writeFile(image, newImage);
  await symlink(image, `${image}.link`);
  const args = { packaged: true, executable: ordinary, home };
  assert.equal(await findInstallTarget(args), null);
  assert.equal(await findInstallTarget({ ...args, image: ordinary }), null);
  assert.equal(await findInstallTarget({ ...args, image: `${image}.link` }), null);
  assert.deepEqual(await findInstallTarget({ ...args, image }), { file: image, local: false });
});
