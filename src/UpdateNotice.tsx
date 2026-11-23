import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowUpRight, History, RefreshCw } from 'lucide-react';
import type { Changelog, UpdateStatus } from './types';
import { useModalDismiss } from './MotionFeedback';

function ReleaseNotes({ text }: { text: string }) {
  const blocks: { kind: 'heading' | 'list' | 'paragraph'; lines: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    const kind = heading ? 'heading' : bullet ? 'list' : 'paragraph';
    const value = heading?.[1] ?? bullet?.[1] ?? line;
    if (kind === 'list' && blocks.at(-1)?.kind === 'list') blocks.at(-1)!.lines.push(value);
    else blocks.push({ kind, lines: [value] });
  }
  // Notas externas são dados: nada de HTML ou links vindos da resposta.
  return blocks.length ? blocks.map((block, index) => block.kind === 'heading'
    ? <h4 key={index}>{block.lines[0]}</h4>
    : block.kind === 'list' ? <ul key={index}>{block.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
    : <p key={index}>{block.lines[0]}</p>) : <p>Sem notas disponíveis para esta versão.</p>;
}

function ChangelogDialog({ log, onClose }: { log: Changelog; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const [error, setError] = useState(false);
  const motion = useModalDismiss();

  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    button.current?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  async function acknowledge() {
    if (saving.current) return;
    saving.current = true;
    setError(false);
    try {
      const result = await window.vinqueta?.acknowledgeChangelog(log.to);
      if (!result?.ok || !result.data) throw new Error();
      motion.dismiss(ref.current, () => { ref.current?.close(); onClose(); });
    } catch {
      saving.current = false;
      setError(true);
    }
  }

  return createPortal(<dialog ref={ref} className="modal confirmation-dialog changelog-dialog"
    aria-labelledby="changelog-title" onCancel={event => { event.preventDefault(); void acknowledge(); }}
    onClickCapture={motion.guardInteraction} onKeyDownCapture={motion.guardInteraction}>
    <div className="modal-heading">
      <div><span className="eyebrow">Atualização · {log.from} → {log.to}</span><h2 id="changelog-title">O que mudou no Vinqueta</h2></div>
      <History size={22} aria-hidden="true" />
    </div>
    <div className="changelog-notes">
      {log.notes.length ? log.notes.map(note => <section key={note.version}>
        <h3>Versão {note.version}</h3><ReleaseNotes text={note.body} />
      </section>) : <p>As notas desta atualização ainda não estão disponíveis.</p>}
    </div>
    {error && <p className="field-error" role="alert">Não foi possível registrar a leitura. Tente novamente.</p>}
    <div className="modal-actions"><button ref={button} type="button" className="button primary" onClick={() => void acknowledge()}>Continuar</button></div>
  </dialog>, document.body);
}

export default function UpdateNotice({ canShowChangelog }: { canShowChangelog: boolean }) {
  const [update, setUpdate] = useState<UpdateStatus>();
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(true);
  const [failure, setFailure] = useState('');
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const [queuedLog, setQueuedLog] = useState<Changelog>();

  useEffect(() => {
    let cancelled = false;
    const bridge = window.vinqueta;
    if (!bridge?.checkUpdates) { setChecking(false); return; }
    setChecking(true);
    setFailure('');
    void bridge.checkUpdates().then(result => {
      if (!cancelled && result.ok) setUpdate(result.data);
      else if (!cancelled) setUpdate(undefined);
    }).catch(() => { if (!cancelled) setUpdate(undefined); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (canShowChangelog && update?.changelog && update.changelog.to !== dismissed)
      setQueuedLog(update.changelog);
  }, [canShowChangelog, update, dismissed]);

  async function open(version: string, automatic = update?.automatic) {
    const bridge = window.vinqueta;
    if (!bridge) return;
    setFailure('');
    if (automatic) setInstalling(true);
    try {
      const result = automatic ? await bridge.installUpdate(version) : await bridge.openUpdate(version);
      if (!result.ok) throw new Error();
    } catch {
      setInstalling(false);
      setFailure(automatic ? 'Não foi possível instalar a atualização.' : 'Não foi possível abrir a release.');
    }
  }

  return <div className="update-notice">
    {checking ? <span className="update-status" role="status">Verificando versão…</span>
      : update?.status === 'available' && update.latest ? <button type="button" className="button update-button primary"
        disabled={!canShowChangelog || installing} title={update.automatic ? 'Baixar, instalar e reabrir o Vinqueta' : 'Abrir a release para instalação manual'}
        onClick={() => void open(update.latest!)}>Atualizar para {update.latest} {update.automatic ? <ArrowDownToLine size={14} aria-hidden="true" /> : <ArrowUpRight size={14} aria-hidden="true" />}</button>
      : update?.status === 'current' ? <span className="update-status current" role="status"><span className="small-dot" aria-hidden="true" /> Atualizado {update.current}</span>
      : <button type="button" className="button update-button secondary" onClick={() => setAttempt(n => n + 1)}
        title="Não foi possível confirmar a versão mais recente."><RefreshCw size={14} aria-hidden="true" /> Verificar atualização</button>}
    {failure && <span className="update-failure" role="alert">{failure}{update?.automatic && update.latest && <> <button type="button" className="text-button" onClick={() => void open(update.latest!, false)}>Abrir no GitHub</button></>}</span>}
    {queuedLog && <ChangelogDialog log={queuedLog} onClose={() => { setDismissed(queuedLog.to); setQueuedLog(undefined); }} />}
  </div>;
}
