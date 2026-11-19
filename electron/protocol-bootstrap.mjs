import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { secretService } from './credential-vault.mjs';

export const BOOTSTRAP_FILE = 'volume-profile.bin';
const schema = 'com.kelvinmattosdev.vinqueta.VolumeProtocol';
// Material público. O envelope evita texto claro no instalador, não impede extração.
const mask = createHash('sha256').update('vinqueta:release:volume-profile:v1').digest();

function requireKey(key) {
  if (typeof key !== 'string' || key.length < 1 || key.length > 200)
    throw new Error('Configuração de volumes inválida.');
  return key;
}

export async function readProtocolFile(file) {
  if ((await stat(file)).size > 4096) throw new Error('Configuração de volumes inválida.');
  try { return requireKey(JSON.parse(await readFile(file, 'utf8')).key); }
  catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw new Error('Configuração de volumes inválida.');
  }
}

export function encodeBootstrap(key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', mask, nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(requireKey(key)), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]);
}

export function decodeBootstrap(blob) {
  if (blob.length <= 28 || blob.length > 4096) throw new Error('Configuração de volumes inválida.');
  const cipher = createDecipheriv('aes-256-gcm', mask, blob.subarray(0, 12));
  cipher.setAuthTag(blob.subarray(12, 28));
  return requireKey(JSON.parse(Buffer.concat([cipher.update(blob.subarray(28)), cipher.final()]).toString('utf8')));
}

export class ProtocolVault {
  constructor(root, service = secretService) {
    this.profile = createHash('sha256').update(root).digest('hex');
    this.service = service;
  }

  async load() {
    const value = await this.service('load', this.profile, '', schema);
    return value ? requireKey(JSON.parse(value)) : null;
  }

  async save(key) {
    const error = new Error('Não foi possível guardar a configuração de volumes. Desbloqueie o cofre do sistema e tente novamente.');
    try {
      await this.service('save', this.profile, JSON.stringify(requireKey(key)), schema);
      if (await this.load() !== key) throw error;
    } catch { throw error; }
  }

  async initialize({ legacyFiles, bootstrapFile }) {
    let unavailable = false;
    try {
      const saved = await this.load();
      if (saved) return { key: saved };
    } catch { unavailable = true; }

    for (const file of legacyFiles) {
      let key;
      try { key = await readProtocolFile(file); }
      catch { continue; }
      // Preserve instalações antigas mesmo sem um cofre disponível. Não escreva novo JSON.
      if (!unavailable) await this.save(key).catch(() => {});
      return { key };
    }

    if (bootstrapFile) {
      let info;
      try { info = await stat(bootstrapFile); }
      catch (error) { if (error.code === 'ENOENT') return { key: null }; throw error; }
      if (unavailable) return { key: null, vaultUnavailable: true };
      if (!info.isFile() || info.size > 4096) return { key: null };
      let key;
      try { key = decodeBootstrap(await readFile(bootstrapFile)); }
      catch { return { key: null }; }
      try { await this.save(key); }
      catch { return { key: null, vaultUnavailable: true }; }
      return { key };
    }
    return { key: null };
  }
}
