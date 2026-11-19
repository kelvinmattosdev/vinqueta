import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

const REPOSITORY = 'kelvinmattosdev/vinqueta';
const API = `https://api.github.com/repos/${REPOSITORY}/releases`;
const RELEASES = `https://github.com/${REPOSITORY}/releases`;
const stable = value => typeof value === 'string' && /^v?(?:0|[1-9]\d{0,7})\.(?:0|[1-9]\d{0,7})\.(?:0|[1-9]\d{0,7})$/.test(value)
  ? value.replace(/^v/, '') : null;
export function compareVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function parseChangelog(text) {
  return [...text.matchAll(/^##[ \t]+\[?(v?\d+\.\d+\.\d+)\]?(?:[ \t]+[^\r\n]*)?\r?\n([\s\S]*?)(?=^##[ \t]+|(?![\s\S]))/gm)]
    .flatMap(([, tag, body]) => {
      const version = stable(tag);
      return version && body.trim() ? [{ version, body: body.trim() }] : [];
    });
}

async function jsonPage(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Resposta de releases vazia.');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4 * 1024 * 1024) throw new Error('Resposta de releases muito grande.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class UpdateService {
  constructor(version, stateFile, localNotes, fetcher = fetch) {
    this.version = stable(version);
    if (!this.version) throw new Error('Versão instalada fora do formato esperado.');
    this.stateFile = stateFile;
    this.localNotes = localNotes;
    this.fetcher = fetcher;
    this.latestRelease = null;
    this.pendingVersion = false;
    this.inFlight = null;
  }

  async loadPublicReleases() {
    const releases = [];
    // Use somente URLs construídas aqui, nunca URLs recebidas da API.
    const signal = AbortSignal.timeout(8000);
    for (let page = 1; page <= 10; page++) {
      const response = await this.fetcher(`${API}?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vinqueta' },
        redirect: 'error', signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`GitHub Releases retornou ${response.status}.`);
      }
      const list = await jsonPage(response);
      if (!Array.isArray(list)) throw new Error('Resposta de releases inesperada.');
      for (const entry of list) {
        const tag = entry?.tag_name;
        const version = stable(tag);
        if (!version || entry.draft !== false || entry.prerelease !== false) continue;
        releases.push({ tag, version, body: typeof entry.body === 'string' ? entry.body.slice(0, 20000).trim() : '' });
      }
      if (list.length < 100 || !/rel="next"/.test(response.headers.get('link') || '')) return releases;
    }
    throw new Error('Histórico de releases maior que o limite de consulta.');
  }

  async readSeen() {
    try { return stable((await readFile(this.stateFile, 'utf8')).trim()); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async writeSeen() {
    await mkdir(dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${this.version}\n`, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.stateFile);
    } finally { await rm(temporary, { force: true }); }
  }
  async check() {
    if (!this.inFlight) {
      this.inFlight = this.inspect().finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }
  async inspect() {
    const seen = await this.readSeen();
    if (!seen) await this.writeSeen(); // Instalação sem histórico: registra o ponto de partida.
    let releases = [], status = 'unavailable';
    this.latestRelease = null;
    try {
      releases = await this.loadPublicReleases();
      const latest = releases.sort((a, b) => compareVersions(b.version, a.version))[0];
      if (latest) {
        if (compareVersions(latest.version, this.version) > 0) {
          this.latestRelease = latest;
          status = 'available';
        } else status = 'current';
      }
    } catch { /* Acesso à Havan e notas empacotadas não dependem do GitHub. */ }

    let changelog = null;
    this.pendingVersion = Boolean(seen && compareVersions(seen, this.version) < 0);
    if (this.pendingVersion) {
      const entries = new Map(this.localNotes.map(note => [note.version, note.body]));
      for (const note of releases) if (note.body || !entries.has(note.version)) entries.set(note.version, note.body);
      const notes = [...entries].filter(([version]) => compareVersions(version, seen) > 0 &&
        compareVersions(version, this.version) <= 0).sort(([a], [b]) => compareVersions(a, b))
        .map(([version, body]) => ({ version, body }));
      changelog = { from: seen, to: this.version, notes };
    }
    return { current: this.version, status, latest: this.latestRelease?.version ?? null, changelog };
  }
  async acknowledge(version) {
    if (version !== this.version || !this.pendingVersion) return false;
    const seen = await this.readSeen();
    if (!seen || compareVersions(seen, this.version) < 0) await this.writeSeen();
    this.pendingVersion = false;
    return true;
  }
  releaseUrl(version) {
    if (!this.latestRelease || this.latestRelease.version !== version) return null;
    return `${RELEASES}/tag/${encodeURIComponent(this.latestRelease.tag)}`;
  }
}
