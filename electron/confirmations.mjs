import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const actions = new Set(['integration-download', 'volume-generate', 'print']);
export class Confirmations {
  constructor(file, present) { this.file = file; this.present = present; this.pending = null; }
  async preferences() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      return Object.fromEntries([...actions].map(action => [action, parsed[action] === true]));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw new Error('Não foi possível ler as preferências de avisos.');
    }
  }
  async save(preferences) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(preferences), { flag: 'wx', mode: 0o600 });
    await rename(temporary, this.file);
  }
  async reset() { await this.save({}); return true; }
  async ask(action, options) {
    if (!actions.has(action) || this.pending) throw new Error('Confirmação indisponível.');
    if ((await this.preferences())[action]) return true;
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pending = { id, action, resolve, reject };
      this.present({ id, ...options });
    });
  }
  async respond(input) {
    const pending = this.pending;
    if (!pending || input?.id !== pending.id || typeof input.confirmed !== 'boolean' ||
        typeof input.remember !== 'boolean') return;
    this.pending = null;
    try {
      // Cancelar, Escape e fechar nunca suprimem avisos futuros.
      if (input.confirmed && input.remember)
        await this.save({ ...await this.preferences(), [pending.action]: true });
      pending.resolve(input.confirmed);
    } catch { pending.reject(new Error('Não foi possível salvar a preferência. A operação foi cancelada.')); }
  }
  cancel() {
    this.pending?.resolve(false);
    this.pending = null;
  }
}
