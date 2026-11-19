import { createHash } from 'node:crypto';
import forge from 'node-forge';

const IV = Buffer.from([15, 111, 19, 46, 53, 194, 205, 249]);
const sha1 = bytes => createHash('sha1').update(bytes).digest();

// Compatibilidade com PasswordDeriveBytes (.NET), não PBKDF2.
// RC2: LegalKeySizes 40..128, em passos de 8; chave truncada para 16 caracteres.
export function deriveKey(passphrase) {
  let text = passphrase.slice(0, 16);
  const bits = text.length * 8;
  if (bits < 128) {
    const size = bits <= 40 ? 40 : bits - bits % 8 + 8;
    if (bits < size) text = text.padEnd(size / 8, '*');
  }
  let base = sha1(Buffer.from(text, 'utf8'));
  for (let i = 1; i < 99; i++) base = sha1(base);
  return sha1(base).subarray(0, text.length);
}

export function createCodec(passphrase) {
  if (typeof passphrase !== 'string' || !passphrase.length) throw new Error('Protocolo não configurado.');
  const key = deriveKey(passphrase).toString('binary');
  return {
    encrypt(value) {
      const cipher = forge.rc2.createEncryptionCipher(key, key.length * 8);
      cipher.start(IV.toString('binary'));
      cipher.update(forge.util.createBuffer(Buffer.from(JSON.stringify(value), 'utf8').toString('binary')));
      if (!cipher.finish()) throw new Error('Não foi possível preparar a requisição.');
      return forge.util.encode64(cipher.output.getBytes());
    },
    decrypt(value) {
      if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
        throw new Error('Resposta criptografada inválida.');
      const cipher = forge.rc2.createDecryptionCipher(key, key.length * 8);
      cipher.start(IV.toString('binary'));
      cipher.update(forge.util.createBuffer(forge.util.decode64(value)));
      if (!cipher.finish()) throw new Error('A resposta não é compatível com o protocolo importado.');
      try { return JSON.parse(Buffer.from(cipher.output.getBytes(), 'binary').toString('utf8')); }
      catch { throw new Error('O servidor retornou dados que não puderam ser interpretados.'); }
    },
  };
}
