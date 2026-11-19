import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// libsecret negocia o acesso ao cofre Secret Service. A credencial passa
// apenas por pipes privados, nunca em argumentos, ambiente ou arquivos.
const helper = `
const { Gio, Secret } = imports.gi;
const [action, profile, schemaName] = ARGV;
const schema = new Secret.Schema(schemaName,
  Secret.SchemaFlags.NONE, { profile: Secret.SchemaAttributeType.STRING });
const attributes = { profile };
try {
  if (action === 'save') {
    const input = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: 0 }) });
    const [secret] = input.read_line_utf8(null);
    if (!secret || !Secret.password_store_sync(schema, attributes, Secret.COLLECTION_DEFAULT,
      'Vinqueta — acesso de fornecedor Havan', secret, null)) imports.system.exit(1);
  } else if (action === 'load') {
    const secret = Secret.password_lookup_sync(schema, attributes, null);
    if (secret !== null) print(secret);
  } else if (action === 'clear') {
    Secret.password_clear_sync(schema, attributes, null);
  } else {
    imports.system.exit(1);
  }
} catch (_) { imports.system.exit(1); }
`;

export function secretService(action, profile, input = '', schema = 'com.kelvinmattosdev.vinqueta.SupplierAccess') {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('Cofre de senhas do sistema indisponível.'));
    if (process.platform !== 'linux') { fail(); return; }
    const child = spawn('/usr/bin/gjs', ['-c', helper, action, profile, schema], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let size = 0;
    const timeout = setTimeout(() => { child.kill('SIGKILL'); fail(); }, 20000);
    child.on('error', () => { clearTimeout(timeout); fail(); });
    child.stdin.on('error', () => {}); // O cofre pode fechar o pipe antes da leitura.
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 16384) { child.kill('SIGKILL'); fail(); }
      else chunks.push(chunk);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || size > 16384) { fail(); return; }
      resolve(Buffer.concat(chunks).toString('utf8').trim());
    });
    child.stdin.end(input ? `${input}\n` : undefined);
  });
}

export class CredentialVault {
  constructor(root, service, schema) {
    this.root = root;
    this.marker = join(root, 'acesso-salvo');
    this.profile = createHash('sha256').update(root).digest('hex');
    if (service) this.service = service;
    this.schema = schema;
  }
  service(action, profile, input) { return secretService(action, profile, input, this.schema); }
  async enabled() {
    try { return (await readFile(this.marker, 'utf8')) === '1'; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async save({ username, password }) {
    // O disco guarda apenas a autorização para entrar automaticamente.
    const encoded = JSON.stringify({ username, password });
    if (Buffer.byteLength(encoded) >= 16384) throw new Error('Acesso salvo excede o limite do cofre.');
    await this.service('save', this.profile, encoded);
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await writeFile(this.marker, '1', { mode: 0o600 });
    } catch (error) {
      await this.service('clear', this.profile).catch(() => {});
      throw error;
    }
  }
  async load() {
    if (!await this.enabled()) return null;
    const secret = await this.service('load', this.profile);
    if (!secret) { await this.disarm(); return null; }
    const data = JSON.parse(secret);
    if (typeof data?.username !== 'string' || !data.username.trim() ||
        typeof data?.password !== 'string' || !data.password.trim()) throw new Error('Acesso salvo inválido.');
    return { username: data.username, password: data.password };
  }
  async disarm() { await rm(this.marker, { force: true }); }
  async forget() {
    // Desliga o acesso automático mesmo se o cofre estiver bloqueado.
    const enabled = await this.enabled();
    await this.disarm();
    if (enabled) await this.service('clear', this.profile);
  }
}
