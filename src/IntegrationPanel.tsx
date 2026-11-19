import { useState } from 'react';
import { Download, FileInput, Plus, Search } from 'lucide-react';
import type { Integration, PortalOrder, PriceInput, Result } from './types';
import { validatePriceItem } from '../shared/price.mjs';
import AnimatedCheckbox from './AnimatedCheckbox';

type Props = { busy: string; act: (label: string, fn: () => Promise<void>) => Promise<void>; onAdd: (items: PriceInput[]) => void };
async function unwrap<T>(request: Promise<Result<T>>) {
  const result = await request;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const count = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

export default function IntegrationPanel({ busy, act, onAdd }: Props) {
  const [code, setCode] = useState('');
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [queried, setQueried] = useState(false);
  const [paginated, setPaginated] = useState(false);
  const [document, setDocument] = useState<Integration>();
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const bridge = window.vinqueta;
  async function run(label: string, fn: () => Promise<void>) {
    setError(''); setMessage('');
    await act(label, async () => {
      try { await fn(); }
      catch (e) { setError(e instanceof Error ? e.message : 'A operação falhou.'); throw e; }
    });
  }
  function review(result: Integration) {
    setDocument(result);
    setSelected(result.rows.filter(row => !row.issue).map(row => row.id));
    setQuantities(Object.fromEntries(result.rows.map(row => [row.id, String(row.quantity)])));
  }
  function addRows() {
    setError(''); setMessage('');
    try {
      if (!document) return;
      const rows = document.rows.filter(row => selected.includes(row.id)).map(row => {
        const input = { name: row.name, ean: row.ean, price: row.price, quantity: Number(quantities[row.id]),
          source: { kind: 'integration' as const, order: document.order, version: document.version, sha256: document.sha256,
            productCode: row.productCode, variationCode: row.variationCode } };
        validatePriceItem(input);
        return input;
      });
      if (!rows.length) throw new Error('Selecione pelo menos uma variação válida.');
      onAdd(rows);
      setSelected([]);
      setMessage(`${rows.length} variação(ões) adicionada(s) ao lote abaixo. Confira os dados e confirme a geração no final da página.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Confira a seleção.'); }
  }
  return <section className="data-panel integration-panel">
    <div className="section-heading"><FileInput size={18} /><h2>Automático pelo pedido</h2><button className="button secondary" type="button" disabled={!!busy || !bridge} onClick={() => run('Lendo integração local', async () => {
      const result = await unwrap(bridge!.importIntegration()); if (result) review(result);
    })}><FileInput size={16} /> Importar XML ou RAR</button></div>
    <div className="integration-intro">
      <p>Abra um arquivo já baixado ou consulte o portal para preencher os produtos, EANs, preços de venda e quantidades. Nenhuma impressão é disparada nesta etapa.</p>
      <form className="portal-filter" onSubmit={e => {
        e.preventDefault();
        if (!bridge) return;
        run('Consultando pedidos no portal', async () => {
          setOrders([]);
          const result = await unwrap(bridge.portalOrders({ code })); setOrders(result.orders); setPaginated(result.paginated); setQueried(true);
        });
      }}>
        <div><label htmlFor="portal-order">Pedido no portal</label><input id="portal-order" value={code} disabled={!!busy} onChange={e => setCode(e.target.value)} placeholder="Em branco para listar todos" /></div>
        <button className="button secondary" disabled={!!busy || !bridge}><Search size={16} /> Consultar portal</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {message && <p className="integration-message" role="status">{message}</p>}
    </div>
    {queried && <div className="integration-orders">
      {paginated && <p className="print-warning">O portal retornou paginação. Esta lista não garante todos os pedidos; filtre pelo número completo.</p>}
      {orders.length ? <div className="table-scroll"><table><thead><tr><th>Pedido</th><th>Versão no portal</th><th>Situação</th><th>Entrega</th><th><span className="sr-only">Download</span></th></tr></thead><tbody>{orders.map(order => <tr key={order.key}><td className="mono">{order.code}</td><td>{order.version}</td><td>{order.status || '—'}</td><td>{order.delivery || '—'}</td><td><button className="text-button" disabled={!!busy || !order.available} onClick={() => run('Baixando e lendo integração', async () => {
        const result = await unwrap(bridge!.portalDownload(order.key)); if (result) review(result);
      })}><Download size={15} /> {order.available ? 'Ler integração' : 'Sem integração'}</button></td></tr>)}</tbody></table></div> : <p className="storage-note">Nenhum pedido nesta consulta.</p>}
    </div>}
    {document && <div className="integration-review">
      <div className="section-heading"><FileInput size={17} /><h2>Integração · {document.order}</h2><span>{document.rows.length} variação(ões)</span></div>
      <div className="integration-source"><span>XML: {document.sourceName}</span><span>Versão do XML: {document.version || 'não informada'}{document.portalVersion ? ` · Portal: ${document.portalVersion}` : ''}</span><strong>Preço: PrecoVenda · Quantidade: QuantidadePrimariaTotalSolicitada</strong></div>
      {document.warnings.length > 0 && <ul className="integration-warnings">{document.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      <div className="table-scroll"><table><thead><tr><th><span className="sr-only">Selecionar</span></th><th>Produto / variação</th><th>EAN</th><th>Venda</th><th>Quantidade de etiquetas</th></tr></thead><tbody>{document.rows.map(row => <tr key={row.id}><td><AnimatedCheckbox aria-label={`Selecionar integração ${row.productCode} variação ${row.variationCode}`} disabled={!!busy || !!row.issue} checked={selected.includes(row.id)} onChange={e => setSelected(e.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} /></td><td><strong>{row.name}</strong><small className="product-code">{row.productCode} · {row.variation || row.variationCode}</small>{row.issue && <span className="field-error">{row.issue}</span>}</td><td className="mono">{row.ean || 'Ausente'}</td><td className="mono">R$ {row.price || '—'}</td><td><input type="number" aria-label={`Quantidade da integração ${row.productCode} variação ${row.variationCode}`} value={quantities[row.id] ?? ''} min="1" max="100000" step="1" disabled={!!busy || !!row.issue} onChange={e => setQuantities(current => ({ ...current, [row.id]: e.target.value }))} /><span className="field-help">XML: {count(row.quantity)} {row.unit}</span></td></tr>)}</tbody></table></div>
      <div className="selection-bar"><div><strong>{selected.length} variação(ões) selecionada(s)</strong><span>Os templates e comandos embutidos no XML não são executados. A saída usa o perfil de 33 × 22 mm.</span></div><button className="button secondary" disabled={!!busy || !selected.length} onClick={addRows}><Plus size={16} /> Adicionar selecionados ao lote</button></div>
    </div>}
  </section>;
}
