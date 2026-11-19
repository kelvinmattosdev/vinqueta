import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UpdateService, parseChangelog } from '../electron/updates.mjs';

const release = (tag, body = '', overrides = {}) => ({ tag_name: tag, body, draft: false, prerelease: false, ...overrides });
async function state(t, seen) {
  const dir = await mkdtemp('/tmp/opencode/vinqueta-updates-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'updates-seen');
  if (seen) await writeFile(file, seen);
  return file;
}

test('ordena versões numericamente, ignora rascunhos e só abre o endereço oficial', async t => {
  const file = await state(t);
  let fetches = 0;
  const updates = new UpdateService('1.9.0', file, [], async (url, input) => {
    fetches++;
    assert.equal(url, 'https://api.github.com/repos/kelvinmattosdev/vinqueta/releases?per_page=100&page=1');
    assert.equal(input.redirect, 'error');
    assert.equal(input.headers.Authorization, undefined);
    return Response.json([
      release('v1.9.0'), release('v1.10.0', '', { html_url: 'https://fora.example/' }),
      release('v7.0.0', '', { draft: true }), release('v5.0.0', '', { prerelease: true }),
      release('v12.0.0-beta.1'),
    ]);
  });
  const [found, same] = await Promise.all([updates.check(), updates.check()]);
  assert.equal(fetches, 1);
  assert.deepEqual(found, same);
  assert.deepEqual(found, { current: '1.9.0', latest: '1.10.0', status: 'available', changelog: null });
  assert.equal(updates.releaseUrl('1.10.0'), 'https://github.com/kelvinmattosdev/vinqueta/releases/tag/v1.10.0');
  assert.equal(updates.releaseUrl('7.0.0'), null);
  assert.equal(await readFile(file, 'utf8'), '1.9.0\n');
});

test('changelog agrega patches e versões intermediárias e some após confirmar', async t => {
  const file = await state(t, '1.0.0\n');
  const local = parseChangelog('# Mudanças\n\n## 1.5.0\n\n### Adicionado\n\n- Versão atual\n\n## [1.4.0] - data\n\n- Melhoria local\n');
  const fetcher = async () => Response.json([
    release('v1.0.0', 'anterior'), release('v1.1.0', 'Melhoria'), release('v1.2.0', 'Novo painel'),
    release('v1.2.1', '### Segurança\n- Correção'), release('v1.3.0', 'Melhoria'),
    release('v1.4.0'), release('v1.5.0'), release('v1.6.0', 'Futuro'),
  ]);
  const client = new UpdateService('1.5.0', file, local, fetcher);
  const { changelog } = await client.check();
  assert.deepEqual(changelog.notes.map(n => n.version), ['1.1.0', '1.2.0', '1.2.1', '1.3.0', '1.4.0', '1.5.0']);
  assert.match(changelog.notes[2].body, /Segurança/);
  assert.equal(changelog.notes[4].body, '- Melhoria local');
  assert.equal(await client.acknowledge('1.6.0'), false);
  assert.equal(await readFile(file, 'utf8'), '1.0.0\n');
  assert.equal(await client.acknowledge('1.5.0'), true);
  assert.equal((await new UpdateService('1.5.0', file, local, fetcher).check()).changelog, null);
  assert.equal((await new UpdateService('1.4.0', file, local, fetcher).check()).changelog, null);
  assert.equal(await readFile(file, 'utf8'), '1.5.0\n');
});

test('GitHub indisponível não sinaliza versão em dia e usa as notas do pacote', async t => {
  const file = await state(t, '1.1.0');
  const notes = [{ version: '1.1.1', body: 'Correção offline' }];
  const client = new UpdateService('1.1.1', file, notes, async () => new Response(null, { status: 404 }));
  const result = await client.check();
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.changelog.notes, notes);
  const available = new UpdateService('1.1.1', file, notes, async () => Response.json([release('v1.1.1')]));
  assert.equal((await available.check()).status, 'current');
});

test('busca o histórico paginado sem seguir links arbitrários', async t => {
  const file = await state(t, '1.0.0');
  const calls = [];
  const client = new UpdateService('1.1.0', file, [], async url => {
    calls.push(url);
    if (calls.length === 1) return Response.json(Array.from({ length: 100 }, () => release('v2.0.0', '', { draft: true })), {
      headers: { Link: '<https://fora.example/>; rel="next"' },
    });
    return Response.json([release('v1.1.0', 'Notas na segunda página')]);
  });
  const checked = await client.check();
  assert.equal(checked.status, 'current');
  assert.match(checked.changelog.notes[0].body, /segunda página/);
  assert.equal(calls[1], 'https://api.github.com/repos/kelvinmattosdev/vinqueta/releases?per_page=100&page=2');
});
