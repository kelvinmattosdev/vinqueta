import { createHash } from 'node:crypto';
import { access, link, lstat, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { MAX_UPDATE_BYTES } from './updates.mjs';

const github = 'github.com';
const cdn = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
function isAppImage(header) {
  return header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
    header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02]));
}

export async function findInstallTarget({ packaged, executable, image, platform = process.platform, home = homedir() }) {
  if (!packaged || platform !== 'linux') return null;
  try {
    const file = image || executable;
    if (!isAbsolute(file)) return null;
    const target = await realpath(file);
    const info = await lstat(target);
    if (!info.isFile() || info.uid !== process.getuid()) return null;
    await access(dirname(target), constants.W_OK | constants.X_OK);
    if (image) {
      if (target !== file) return null; // Não sobrescreve um destino apontado por link.
      const handle = await open(target, 'r');
      try {
        const header = Buffer.alloc(12);
        await handle.read(header, 0, header.length, 0);
        if (!isAppImage(header)) return null;
      } finally { await handle.close(); }
      return { file: target, local: false };
    }
    const root = await realpath(join(home, '.local/opt/vinqueta'));
    if (basename(target) !== 'vinqueta' || dirname(dirname(target)) !== root ||
        !/^\d+\.\d+\.\d+-\d+$/.test(basename(dirname(target)))) return null;
    return { file: target, local: true };
  } catch { return null; }
}

async function requestDownload(source, signal, fetcher) {
  let url = new URL(source);
  if (url.hostname !== github) throw new Error('Origem de atualização inválida.');
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        !(url.hostname === github || cdn.has(url.hostname))) throw new Error('Origem de atualização inválida.');
    const response = await fetcher(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'Vinqueta' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      const location = response.headers.get('location');
      if (!location) break;
      url = new URL(location, url);
      continue;
    }
    if (response.status === 200 && response.body) return response;
    await response.body?.cancel().catch(() => {});
    break;
  }
  throw new Error('Download indisponível.');
}

const localImageName = 'Vinqueta.AppImage';
const localLauncher = `#!/bin/sh
exec "\${0%/*}/${localImageName}" --appimage-extract-and-run "$@"
`;

export async function installAppImage(target, asset, progress, { fetcher = fetch } = {}) {
  if (!Number.isSafeInteger(asset.size) || asset.size < 12 || asset.size > MAX_UPDATE_BYTES ||
      !/^[a-f0-9]{64}$/.test(asset.digest)) throw new Error('Metadados inválidos.');
  const original = await lstat(target.file);
  if (!original.isFile() || original.uid !== process.getuid()) throw new Error('Instalação inválida.');
  const directory = dirname(target.file);
  const scratch = await mkdtemp(join(directory, '.vinqueta-update-'));
  const candidate = join(scratch, 'download');
  const signal = AbortSignal.timeout(15 * 60 * 1000);
  let bytes = 0, last = -1;
  const hash = createHash('sha256');
  let header = Buffer.alloc(0);
  try {
    const response = await requestDownload(asset.url, signal, fetcher);
    const measure = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > asset.size) return callback(new Error('Download maior que o anunciado.'));
        if (header.length < 12) header = Buffer.concat([header, chunk.subarray(0, 12 - header.length)]);
        hash.update(chunk);
        const percent = Math.min(99, Math.floor(bytes * 100 / asset.size));
        if (percent !== last) { last = percent; progress('download', percent); }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), measure, createWriteStream(candidate, { flags: 'wx', mode: 0o700 }), { signal });
    progress('verify', 99);
    if (bytes !== asset.size || hash.digest('hex') !== asset.digest || !isAppImage(header))
      throw new Error('Falha na verificação do pacote.');
    const current = await lstat(target.file);
    if (current.ino !== original.ino || current.dev !== original.dev || !current.isFile())
      throw new Error('A instalação mudou durante a atualização.');
    progress('install', 99);
    if (target.local) {
      const launcher = join(scratch, 'launcher');
      const image = join(directory, localImageName);
      await writeFile(launcher, localLauncher, { mode: 0o700, flag: 'wx' });
      await link(candidate, image);
      try { await rename(launcher, target.file); }
      catch (error) { await rm(image, { force: true }); throw error; }
    } else {
      await rename(candidate, target.file);
    }
    progress('restart', 100);
    return target.file;
  } finally { await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
}
