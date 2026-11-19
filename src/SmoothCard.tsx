import { useLayoutEffect, useRef, type ReactNode } from 'react';

export default function SmoothCard({ className, children }: { className: string; children: ReactNode }) {
  const card = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const shell = card.current, inner = content.current;
    if (!shell || !inner || typeof ResizeObserver === 'undefined' || !shell.animate) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let previous = inner.getBoundingClientRect();
    let active: Animation | undefined;

    const stop = () => { active?.cancel(); active = undefined; };
    const observer = new ResizeObserver(() => {
      const next = inner.getBoundingClientRect();
      const last = previous;
      previous = next;
      // Não anime ao mostrar uma aba antes oculta ou mudar a largura da janela.
      if (!last.width || !next.width || Math.abs(last.width - next.width) > .5 || reduced.matches) {
        stop();
        return;
      }
      if (Math.abs(last.height - next.height) < .5) return;
      const style = getComputedStyle(shell);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const from = active ? shell.getBoundingClientRect().height : last.height + border;
      const to = next.height + border;
      stop();
      if (Math.abs(from - to) < .5) return;
      const resize = shell.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: 300,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
      active = resize;
      resize.onfinish = () => { if (active === resize) active = undefined; };
    });
    observer.observe(inner);
    reduced.addEventListener('change', stop);
    return () => {
      observer.disconnect();
      reduced.removeEventListener('change', stop);
      stop();
    };
  }, []);

  return <section ref={card} className={className}>
    <div ref={content} className="smooth-card-content">{children}</div>
  </section>;
}
