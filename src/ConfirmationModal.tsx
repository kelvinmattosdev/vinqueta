import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'lucide-react';
import type { Confirmation } from './types';
import { useModalDismiss } from './MotionFeedback';
import AnimatedCheckbox from './AnimatedCheckbox';

export default function ConfirmationModal() {
  const [request, setRequest] = useState<Confirmation>();
  const [remember, setRemember] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const motion = useModalDismiss();
  useEffect(() => window.vinqueta?.onConfirmation(input => {
    setRemember(false); setRequest(input);
  }), []);
  useEffect(() => {
    if (request) {
      ref.current?.showModal();
      ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [request]);
  function respond(confirmed: boolean) {
    if (!request) return;
    motion.dismiss(ref.current, () => {
      ref.current?.close(); setRequest(undefined);
      window.vinqueta?.respondConfirmation({ id: request.id, confirmed, remember: confirmed && remember });
    });
  }
  return request && createPortal(<dialog ref={ref} className="modal confirmation-dialog"
    aria-labelledby="confirmation-title" aria-describedby="confirmation-detail"
    onClickCapture={motion.guardInteraction} onKeyDownCapture={motion.guardInteraction}
    onCancel={e => { e.preventDefault(); respond(false); }}>
    <div className="modal-heading"><div><span className="eyebrow"><ShieldCheck size={16} /> Confirmação da operação</span><h2 id="confirmation-title">{request.title}</h2></div></div>
    <p id="confirmation-detail">{request.detail}</p>
    <label className="confirmation-remember"><AnimatedCheckbox checked={remember} onChange={e => setRemember(e.target.checked)} /> Não exibir novamente este tipo de aviso</label>
    <p className="field-help">Para reativar os avisos, vá a Configurações → Avisos de confirmação → Restaurar avisos.</p>
    <div className="modal-actions"><button className="button secondary" autoFocus onClick={() => respond(false)}>Cancelar</button><button className="button primary" onClick={() => respond(true)}>{request.confirmLabel}</button></div>
  </dialog>, document.body);
}
