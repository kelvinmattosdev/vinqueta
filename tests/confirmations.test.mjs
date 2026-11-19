import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Confirmations } from '../electron/confirmations.mjs';

test('cancelar não memoriza; confirmar memoriza por tipo, persiste e permite restaurar', async () => {
  const root = await mkdtemp('/tmp/opencode/vinqueta-avisos-');
  try {
    let current, displayed;
    const broker = new Confirmations(join(root, 'avisos.json'), input => { current = input; displayed?.(); });
    async function open(action) {
      const shown = new Promise(resolve => { displayed = resolve; });
      const result = broker.ask(action, { title: 'Teste', detail: 'Detalhe', confirmLabel: 'Continuar' });
      await shown;
      return { result };
    }
    let pending = await open('integration-download');
    await broker.respond({ id: 'id-errado', confirmed: true, remember: true });
    assert(broker.pending);
    await broker.respond({ id: current.id, confirmed: false, remember: true });
    assert.equal(await pending.result, false);
    assert.deepEqual(await broker.preferences(), {});
    pending = await open('integration-download');
    await broker.respond({ id: current.id, confirmed: true, remember: true });
    assert.equal(await pending.result, true);
    const restarted = new Confirmations(join(root, 'avisos.json'), () => assert.fail('Aviso deveria estar suprimido'));
    assert.equal(await restarted.ask('integration-download', {}), true);
    assert.equal((await restarted.preferences()).print, false);
    await restarted.reset();
    assert.deepEqual(await restarted.preferences(), { 'integration-download': false, 'volume-generate': false, print: false });
    pending = await open('print'); broker.cancel();
    assert.equal(await pending.result, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
