import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';

export function StateText({ text }: { text: string }) {
  const [swap, setSwap] = useState({ current: text, previous: '', version: 0 });
  if (swap.current !== text) setSwap({ current: text, previous: swap.current, version: swap.version + 1 });
  return <span className="state-text">
    <span className="sr-only">{text}</span>
    <span key={swap.version} className={swap.previous ? 'state-text-visual swapping' : 'state-text-visual'} aria-hidden="true">
      {swap.previous && <span className="state-text-out">{swap.previous}</span>}
      <span className="state-text-in">{text}</span>
    </span>
  </span>;
}

export function SuccessCheck() {
  return <span className="success-check" aria-hidden="true">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 4 4L19 6" pathLength="1" />
    </svg>
  </span>;
}

const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fieldShakes = new WeakMap<HTMLElement, Animation>();

export function shakeField(field: HTMLElement) {
  fieldShakes.get(field)?.cancel();
  if (reduceMotion() || !field.animate) return;
  const animation = field.animate(
    [0, 6, -6, 4, 0].map((x, i) => ({ transform: `translateX(${x}px)`, offset: [0, 80, 140, 220, 280][i] / 280, easing: ease })),
    { duration: 280 },
  );
  fieldShakes.set(field, animation);
}

// O diálogo continua montado e modal até o fim da saída. Com movimento
// reduzido não há atraso na ação; com animação, bloqueia cliques repetidos.
export function useModalDismiss() {
  const running = useRef<Animation | undefined>(undefined);
  const guarded = useRef(false);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { if (media.matches) running.current?.finish(); };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
      running.current?.cancel();
    };
  }, []);

  function dismiss(dialog: HTMLElement | null, close: () => void, backdrop?: HTMLElement | null) {
    if (guarded.current) return;
    if (!dialog?.animate || reduceMotion()) { close(); return; }
    guarded.current = true;
    (backdrop ?? dialog).dataset.closing = 'true';
    const style = getComputedStyle(dialog);
    const opening = { opacity: style.opacity, transform: style.transform };
    const animation = dialog.animate([opening, { opacity: 0, transform: 'scale(.96)' }], {
      duration: 150, easing: ease, fill: 'forwards',
    });
    running.current = animation;
    animation.onfinish = () => {
      running.current = undefined;
      guarded.current = false;
      close();
    };
  }
  function guardInteraction(event: MouseEvent | KeyboardEvent) {
    if (guarded.current) { event.preventDefault(); event.stopPropagation(); }
  }
  return { dismiss, guardInteraction };
}
