import type { ReactNode } from 'react';

export type OrderQueryState = 'idle' | 'loading' | 'complete' | 'inconclusive' | 'failed';

export default function OrderResults({ state, empty, children }: {
  state: OrderQueryState;
  empty: boolean;
  children: ReactNode;
}) {
  const loading = state === 'loading';
  const settled = state === 'complete' || state === 'inconclusive';
  return <>
    <span className="sr-only" role="status">{loading ? 'Carregando pedidos.' : ''}</span>
    <div className="order-results" data-state={state} aria-busy={loading}>
      {(loading || settled) && <div className="order-skeleton" aria-hidden="true">
        <div className="order-skeleton-layout">
          <span className="order-skeleton-icon" />
          <div className="order-skeleton-lines"><span /><span /></div>
          <span className="order-skeleton-tag" />
        </div>
        <div className="order-skeleton-block"><span /><span /><span /></div>
      </div>}
      {!loading && <div className={settled && empty ? 'order-empty-reveal' : settled ? 'order-list-reveal' : undefined}>
        {children}
      </div>}
    </div>
  </>;
}
