import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, Check, ChevronRight, FileCode2, FolderOpen, History,
  LayoutGrid, LoaderCircle, LogOut, Package, Printer, Search, ShieldCheck,
  SlidersHorizontal, Tag, X, AlertCircle,
} from 'lucide-react';
import type { Identity, Item, Job, Order, Result, Status } from './types';
import PriceLabels from './PriceLabels';
import ConfirmationModal from './ConfirmationModal';
import Settings from './Settings';
import { StateText, SuccessCheck, useModalDismiss, shakeField } from './MotionFeedback';
import AnimatedCheckbox from './AnimatedCheckbox';
import OrderResults, { type OrderQueryState } from './OrderResults';
import UpdateNotice from './UpdateNotice';

const bridge = window.vinqueta;
const logo = `${import.meta.env.BASE_URL}vinqueta.svg`;
const ORDER_QUERY_LABEL = 'Consultando pedidos';
const date = (input: string) => {
  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? '—' : value.toLocaleDateString('pt-BR');
};
const number = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export default function App() {
  const [status, setStatus] = useState<Status>();
  const [identity, setIdentity] = useState<Identity>();
  const [page, setPage] = useState<'orders' | 'prices' | 'history' | 'settings'>('orders');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [queryState, setQueryState] = useState<OrderQueryState>('idle');
  const [order, setOrder] = useState<Order>();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [preview, setPreview] = useState<{ job: Job; text: string }>();
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState('');
  const [code, setCode] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(0);
  const [login, setLogin] = useState({ username: '', password: '' });
  const [remember, setRemember] = useState(false);
  const startup = useRef(false);
  const modalRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const operationTrigger = useRef<HTMLElement | null>(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  const motion = useModalDismiss();

  useEffect(() => {
    document.querySelector('.content')?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [page]);

  useEffect(() => {
    if (!preview) return;
    const previous = previewTrigger.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.confirmation-dialog[open]')) return;
      if (event.key !== 'Tab') return;
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected && !previous.matches(':disabled')) previous.focus();
      else document.querySelector<HTMLElement>('.nav-item[aria-current="page"]')?.focus();
    };
  }, [preview]);

  useEffect(() => {
    if (!bridge || startup.current) return;
    startup.current = true;
    void act('Verificando acesso salvo', async () => {
      const saved = await unwrap(bridge.autoLogin());
      if (saved) await enterWorkspace(saved);
    });
  }, []);

  async function act(label: string, fn: () => Promise<void>) {
    if (busy) return;
    operationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(label); setNotice(undefined);
    try { await fn(); }
    catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'A operação falhou.', error: true });
    } finally {
      if (bridge) {
        try {
          const current = await unwrap(bridge.status());
          setStatus(current);
          if (!current.authenticated) {
            setIdentity(undefined); setPage('orders'); setOrders([]); setItems([]); setOrder(undefined);
            setSelected([]); setJobs([]); setPreview(undefined); setPrinters([]); setPrinter(''); setQueryState('idle');
            setCode(''); setYear(new Date().getFullYear()); setWeek(0);
          }
        } catch { /* Mantém o erro original. */ }
      }
      setBusy('');
    }
  }
  async function openJob(job: Job) {
    if (!bridge) return;
    previewTrigger.current = operationTrigger.current;
    setPrinter(''); setPrinters([]);
    setPreview(await unwrap(bridge.preview(job.id)));
  }
  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (!bridge) return;
    await act('Validando acesso na Havan', async () => {
      let result;
      try {
        result = await unwrap(bridge.login(login, remember));
      }
      finally { setLogin(current => ({ ...current, password: '' })); }
      await enterWorkspace(result.identity);
      if (result.warning) setNotice({ text: result.warning, error: true });
    });
  }
  async function enterWorkspace(supplier: Identity) {
    if (!bridge) return;
    setIdentity(supplier);
    setPage('orders');
    setBusy(ORDER_QUERY_LABEL);
    try {
      await loadOrders({ code: '', year: new Date().getFullYear(), week: 0 });
    } finally {
      // O histórico fica no disco, mesmo quando a consulta inicial falha.
      const history = await bridge.history();
      if (history.ok) setJobs(history.data);
    }
  }
  async function loadOrders(filters: { code: string; year: number; week: number }) {
    if (!bridge) return;
    setOrders([]); setQueryState('loading');
    try {
      const result = await unwrap(bridge.orders(filters));
      setOrders(result.orders);
      setQueryState(result.inconclusive ? 'inconclusive' : 'complete');
    } catch (error) {
      setQueryState('failed');
      throw error;
    }
  }
  async function searchOrders(e: FormEvent) {
    e.preventDefault();
    if (!bridge) return;
    await act(ORDER_QUERY_LABEL, async () => {
      setOrder(undefined); setItems([]); setSelected([]);
      await loadOrders({ code, year, week });
    });
  }
  async function chooseOrder(row: Order) {
    if (!bridge) return;
    await act('Consultando produtos', async () => {
      setOrder(undefined); setItems([]); setSelected([]);
      const result = await unwrap(bridge.items(row.code));
      setOrder(row); setItems(result);
    });
  }
  async function generate() {
    if (!bridge || !order) return;
    await act('Solicitando e ajustando etiquetas', async () => {
      try {
        const job = await unwrap(bridge.generate(order.code, selected));
        if (job) { setJobs(await unwrap(bridge.history())); await openJob(job); setOrder(undefined); setItems([]); }
      } finally { setSelected([]); }
    });
  }
  const total = items.filter(i => selected.includes(i.index)).reduce((sum, item) => sum + item.quantity, 0);
  function resetWarnings() {
    void act('Restaurando avisos', async () => {
      if (bridge) await unwrap(bridge.resetWarnings());
      setNotice({ text: 'Avisos de download, geração e impressão reativados.', error: false });
    });
  }
  const feedback = <>
    {notice && <div className={`notice ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <AlertCircle size={18} aria-hidden="true" /> : <SuccessCheck />}<span>{notice.text}</span><button className="icon-button" aria-label="Fechar aviso" onClick={() => setNotice(undefined)}><X size={16} /></button></div>}
    {busy && busy !== ORDER_QUERY_LABEL && <div className="progress" role="status"><LoaderCircle className="spin" size={17} aria-hidden="true" /><StateText text={`${busy}…`} /></div>}
  </>;
  function closePreview() {
    if (!busy) motion.dismiss(modalRef.current, () => setPreview(undefined), backdropRef.current);
  }
  const authorCredit = <span>Desenvolvido por <a className="author-credit" href="https://github.com/kelvinmattosdev" target="_blank" rel="noopener noreferrer" onClick={e => {
    if (!bridge) return;
    e.preventDefault();
    void unwrap(bridge.openAuthorGitHub()).catch(() => setNotice({ text: 'Não foi possível abrir o GitHub no navegador.', error: true }));
  }}>Kelvin Mattos</a></span>;

  if (!identity) return <main id="main" className="login-screen">
    <section className="login-panel login-card" aria-labelledby="login-title">
      <div className="login-brand"><img src={logo} width="40" height="40" alt="" />Vinqueta</div>
      <h1 id="login-title">Acesso de fornecedor</h1>
      <p>Faça login com as mesmas credenciais do portal da Havan para consultar seus pedidos e imprimir etiquetas.</p>
      {feedback}
      <form onSubmit={submitLogin} onInvalid={e => { if (e.target instanceof HTMLInputElement) shakeField(e.target); }}>
        <label htmlFor="username">CNPJ do fornecedor</label><input id="username" autoComplete="username" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} required disabled={!!busy} placeholder="Digite o CNPJ da sua conta" />
        <label htmlFor="password">Senha</label><input id="password" autoComplete="current-password" type="password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} required disabled={!!busy} placeholder="Senha do portal de fornecedor" />
        <label className="login-remember"><AnimatedCheckbox checked={remember} disabled={!!busy || !bridge} onChange={e => setRemember(e.target.checked)} /> Lembrar acesso neste computador</label>
        <button className="button primary full" disabled={!!busy || !bridge || !status?.protocol}>Entrar na Havan <ArrowRight size={18} /></button>
      </form>
      <div className="privacy-note"><ShieldCheck size={16} /><span>Se marcar a opção, o CNPJ e a senha ficam no cofre do Linux. Não use em computador compartilhado.</span></div>
      {!bridge && <div className="desktop-note">Abra o aplicativo instalado para conectar sua conta.</div>}
      {bridge && status && !status.protocol && <div className="desktop-note">Importe o arquivo local de compatibilidade para habilitar o login.<button className="text-button" disabled={!!busy} onClick={() => act('Importando configuração', async () => {
        if (await unwrap(bridge.importConfig())) setStatus(await unwrap(bridge.status()));
      })}>Importar configuração local</button></div>}
      <footer className="login-credit">{authorCredit}</footer>
    </section>
  </main>;

  return <div className="app-shell">
    <a className="skip-link" href="#main">Pular para o conteúdo</a>
    <aside className="sidebar" inert={!!preview}>
      <div className="brand"><img className="brand-icon" src={logo} width="40" height="40" alt="" /><div>Vinqueta<span>Central de etiquetas</span></div></div>
      <div className="workspace-label">Área de trabalho</div>
      <nav aria-label="Navegação principal">
        <button className={page === 'orders' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('orders')} aria-current={page === 'orders' ? 'page' : undefined}><LayoutGrid size={18} /> Pedidos</button>
        <button className={page === 'prices' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('prices')} aria-current={page === 'prices' ? 'page' : undefined}><Tag size={18} /> Etiquetas de preço</button>
        <button className={page === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('history')} aria-current={page === 'history' ? 'page' : undefined}><History size={18} /> Lotes salvos <span className="nav-count">{jobs.length}</span></button>
        <button className={page === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('settings')} aria-current={page === 'settings' ? 'page' : undefined}><SlidersHorizontal size={18} /> Configurações</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="paper-spec"><FileCode2 size={20} /><div>Perfil de impressão<span>{page === 'prices' ? '33 × 22 mm · 3 colunas' : '100 × 150 mm · ZPL'}</span></div><span className="small-dot" /></div>
        <div className="account"><div className="avatar">{identity.name.slice(0, 2).toUpperCase()}</div><div className="account-name">{identity.name}<span>Conectado à Havan</span></div>
          {identity && <button className="icon-button" aria-label="Sair da conta" disabled={!!busy} onClick={() => act('Saindo', async () => {
            const result = bridge ? await unwrap(bridge.logout()) : undefined;
            setIdentity(undefined); setOrders([]); setOrder(undefined); setItems([]); setSelected([]);
            setLogin({ username: '', password: '' }); setRemember(false);
            if (result?.warning) setNotice({ text: result.warning, error: true });
          })}><LogOut size={17} /></button>}
        </div>
      </div>
    </aside>
    <div className="main-shell" inert={!!preview}>
      <header className="topbar"><div>Operação <ChevronRight size={14} /><strong>{page === 'settings' ? 'Configurações' : page === 'orders' ? 'Pedidos e etiquetas' : page === 'prices' ? 'Etiquetas de preço' : 'Lotes salvos'}</strong></div><UpdateNotice canShowChangelog={!busy && !preview} /></header>
      <main id="main" className="content">
        <div className="page-title"><div><h1>{page === 'settings' ? 'Configurações' : page === 'orders' ? 'Pedidos da Havan' : page === 'prices' ? 'Etiquetas de preço' : 'Lotes salvos'}</h1><p>{page === 'settings' ? 'Ajuste a aparência e os avisos do aplicativo.' : page === 'orders' ? 'Selecione um pedido para gerar as etiquetas de volume.' : page === 'prices' ? 'Use uma integração do pedido ou preencha os dados da etiqueta manualmente.' : 'Exporte ou imprima um lote sem consultar a Havan.'}</p></div></div>
        {!preview && feedback}
        <div hidden={page !== 'prices'}><PriceLabels busy={busy} act={act} onCreated={async job => {
          if (bridge) setJobs(await unwrap(bridge.history()));
          await openJob(job);
        }} /></div>
        {page === 'settings' ? <Settings busy={busy} canReset={!!bridge} onResetWarnings={resetWarnings} /> : page === 'prices' ? null : page === 'orders' ? <>
            <section className="filter-panel">
              <div className="section-heading"><SlidersHorizontal size={18} /><h2>Filtrar pedidos</h2><span>Conta de {identity.name}</span></div>
              <form className="filter-form" onSubmit={searchOrders}>
                <div className="filter-code"><label htmlFor="order-code">Número do pedido</label><input id="order-code" value={code} onChange={e => setCode(e.target.value)} placeholder="Em branco para listar todos" disabled={!!busy} /></div>
                <div><label htmlFor="year">Ano de entrega</label><input id="year" type="number" min="2000" max="2100" value={year} onChange={e => setYear(Number(e.target.value))} required disabled={!!busy} /></div>
                <div><label htmlFor="week">Semana de entrega</label><select id="week" value={week} onChange={e => setWeek(Number(e.target.value))} disabled={!!busy}><option value={0}>Todas as semanas</option>{Array.from({ length: 53 }, (_, i) => <option key={i + 1} value={i + 1}>Semana {i + 1}</option>)}</select></div>
                <button className="button primary" disabled={!!busy}><Search size={17} /> Buscar pedidos</button>
              </form>
            </section>
            <section className="data-panel">
              <div className="section-heading"><Package size={18} /><h2>Pedidos da Havan</h2>{(queryState === 'complete' || queryState === 'inconclusive') && <span>{orders.length} encontrados</span>}</div>
              <OrderResults state={queryState} empty={orders.length === 0}>
              {orders.length ? <div className="table-scroll"><table><thead><tr><th>Pedido</th><th>Fornecedor</th><th>Emissão</th><th>Entrega</th><th>Situação</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{orders.map(row => <tr key={row.code} className={order?.code === row.code ? 'selected-row' : ''}><td className="mono">{row.code}</td><td>{row.supplier || identity.name}</td><td>{date(row.issued)}</td><td>{row.week || '—'}</td><td><span className="status-tag">{row.status || 'Não informado'}</span></td><td><button className="text-button" disabled={!!busy} onClick={() => chooseOrder(row)}>Ver produtos <ArrowRight size={15} /></button></td></tr>)}</tbody></table></div> : <>
                <Empty icon={<Search size={27} />} title={queryState === 'failed' ? 'Não foi possível carregar os pedidos' : queryState === 'idle' ? 'Busque os pedidos da sua conta' : 'Não foi localizado nenhum pedido em aberto'} text={queryState === 'failed' ? 'Tente buscar novamente.' : queryState === 'idle' ? 'Os pedidos aparecerão aqui após uma consulta à Havan.' : 'Confira os filtros ou busque pelo número do pedido.'} />
                {queryState === 'inconclusive' && <p className="orders-report-note" role="status">Se você esperava encontrar pedidos em aberto, por favor, reporte.</p>}
              </>}
              </OrderResults>
            </section>
            {order && <section className="data-panel">
              <div className="section-heading"><Tag size={18} /><h2>Produtos · {order.code}</h2><button className="text-button" disabled={!!busy} onClick={() => setSelected(selected.length === items.length ? [] : items.map(i => i.index))}>{selected.length === items.length ? 'Limpar seleção' : 'Selecionar todos'}</button></div>
              <div className="table-scroll"><table><thead><tr><th><span className="sr-only">Selecionar</span></th><th>Produto</th><th>Variação</th><th>Pack</th><th>Volumes</th></tr></thead><tbody>{items.map(item => <tr key={item.index}><td><AnimatedCheckbox aria-label={`Selecionar ${item.name}`} disabled={!!busy} checked={selected.includes(item.index)} onChange={e => setSelected(e.target.checked ? [...selected, item.index] : selected.filter(i => i !== item.index))} /></td><td><strong>{item.name}</strong><small className="product-code">{item.code}</small></td><td>{item.variation}</td><td>{item.pack}</td><td className="mono">{number(item.quantity)}</td></tr>)}</tbody></table></div>
              <div className="selection-bar"><div><strong>{number(total)} etiquetas selecionadas</strong><span>Geração integral dos itens. Para volumes já gerados, use os lotes salvos.</span></div><button className="button primary" disabled={!selected.length || !!busy} onClick={generate}>Solicitar e ajustar <ArrowRight size={17} /></button></div>
            </section>}
        </> : <section className="data-panel">
          <div className="section-heading"><FolderOpen size={19} /><h2>Lotes disponíveis</h2><span>Volumes e preços, com perfis separados</span></div>
          {jobs.length ? <div className="table-scroll"><table><thead><tr><th>Origem</th><th>Data</th><th>Etiquetas</th><th>Perfil</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><strong>{job.label}</strong><small className="product-code">{job.files.length} arquivo(s)</small></td><td>{date(job.date)}</td><td className="mono">{number(job.count)}</td><td><span className="status-tag"><Check size={12} /> {job.kind === 'price' ? 'Preço · 33×22' : 'Volume · −30 dots'}</span></td><td><button className="text-button" disabled={!!busy} onClick={() => act('Abrindo lote', () => openJob(job))}>Abrir lote <ArrowRight size={15} /></button></td></tr>)}</tbody></table></div> : <Empty icon={<FolderOpen size={28} />} title="Nenhum lote salvo" text="Importe volumes originais ou gere etiquetas de preço. Cada lote usa seu próprio perfil de impressão." />}
          {status?.storage && <p className="storage-note">Pasta local dos lotes e originais: <code>{status.storage}</code></p>}
        </section>}
        <footer className="app-footer">{authorCredit}<span>{page === 'settings' ? 'Preferências locais' : page === 'prices' ? 'Preço 33 × 22 mm' : 'Volume 100 × 150 mm'} <span className="footer-divider">·</span> v0.6.1</span></footer>
      </main>
    </div>
    {preview && <div ref={backdropRef} className="modal-backdrop" onClickCapture={motion.guardInteraction} onClick={e => { if (e.target === e.currentTarget) closePreview(); }}>
      <section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onKeyDownCapture={motion.guardInteraction} onKeyDown={e => { if (e.key === 'Escape') closePreview(); }}>
        <div className="modal-heading"><div><span className="eyebrow">{preview.job.kind === 'price' ? 'Lote de preços · 33×22' : 'Lote de volumes ajustado'}</span><h2 id="preview-title">{preview.job.label}</h2></div><button className="icon-button" aria-label="Fechar lote" autoFocus disabled={!!busy} onClick={closePreview}><X /></button></div>
        {notice && <div className={`notice modal-notice ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <AlertCircle size={18} aria-hidden="true" /> : <SuccessCheck />}<span>{notice.text}</span></div>}
        {busy && <div className="progress" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" /><StateText text={`${busy}…`} /></div>}
        <div className="job-summary"><span><Check size={17} /> {number(preview.job.count)} etiquetas</span><span>{preview.job.kind === 'price' ? `${number(preview.job.rows ?? 0)} fileiras · 3 colunas` : '−30 dots após a linha de referência'}</span><span>{preview.job.kind === 'price' ? 'EAN em texto · sem parcelas' : 'Dados ^FD preservados'}</span></div>
        {preview.job.kind === 'price' && <div className="price-file-summary">{preview.job.files.map(f => <p key={f.name}><strong>{f.product}</strong><span>{f.ean} · R$ {f.price} · {number(f.count)} etiquetas</span>{f.source && <span>XML do pedido {f.source.order} · versão {f.source.version} · produto {f.source.productCode}, variação {f.source.variationCode}</span>}</p>)}</div>}
        <div className="code-label"><FileCode2 size={16} /> ZPL processado · primeiro arquivo · até 16.000 caracteres</div><pre className="code-preview">{preview.text}</pre>
        <p className="print-warning">{preview.job.kind === 'price' ? 'Papel 33×22 em três colunas, não 10×15. ZPL com 880×200 dots por fileira, mantendo o modelo original. Confira os preços, a resolução e a calibração da impressora. Teste uma fileira antes de imprimir o lote.' : 'Confirme a resolução da impressora e teste uma etiqueta. O ajuste de posição não converte DPI nem garante sozinho os limites físicos de 10×15.'}</p>
        <div className="print-config"><label htmlFor="printer">Fila ZPL no Linux</label><div><select id="printer" value={printer} disabled={!!busy} onChange={e => setPrinter(e.target.value)}><option value="">Selecione uma impressora</option>{printers.map(p => <option key={p}>{p}</option>)}</select><button className="button secondary" disabled={!!busy} onClick={() => act('Buscando impressoras', async () => { if (bridge) { const found = await unwrap(bridge.printers()); setPrinters(found); if (!found.length) setNotice({ text: 'Nenhuma fila CUPS encontrada. Configure uma fila que aceite ZPL raw no Linux.', error: true }); } })}>Buscar filas</button></div></div>
        <div className="modal-actions"><button className="button secondary" disabled={!!busy} onClick={() => act('Exportando lote', async () => {
          if (bridge && await unwrap(bridge.exportJob(preview.job.id))) setNotice({ text: preview.job.kind === 'price' ? 'Etiquetas de preço salvas.' : 'Arquivo ajustado salvo.', error: false });
        })}><ArrowDownToLine size={17} /> {preview.job.kind === 'price' ? 'Exportar preços' : 'Exportar ajustado'}</button><button className="button primary" disabled={!!busy || !printer} onClick={() => act('Enviando ao CUPS', async () => {
          if (bridge) { const receipt = await unwrap(bridge.print(preview.job.id, printer)); if (receipt) setNotice({ text: `Lote enviado à fila. ${receipt}`, error: false }); }
        })}><Printer size={17} /> Enviar à impressora</button></div>
      </section>
    </div>}
    <ConfirmationModal />
  </div>;
}

function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty-state"><div>{icon}</div><h3>{title}</h3><p>{text}</p></div>;
}
