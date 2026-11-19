import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, FileCode2, Plus, Tag, Trash2 } from 'lucide-react';
import { generatePriceZpl, validatePriceItem, MAX_PRICE_LABELS, PriceFieldError } from '../shared/price.mjs';
import { pricePresets } from '../shared/price-presets.mjs';
import type { Job, PriceInput, PricePreviewImage } from './types';
import IntegrationPanel from './IntegrationPanel';
import SmoothCard from './SmoothCard';
import { StateText, shakeField } from './MotionFeedback';
import AnimatedCheckbox from './AnimatedCheckbox';

type Props = {
  busy: string;
  act: (label: string, fn: () => Promise<void>) => Promise<void>;
  onCreated: (job: Job) => Promise<void>;
};
const empty = { name: '', ean: '', price: '', quantity: '3' };
const format = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

export default function PriceLabels({ busy, act, onCreated }: Props) {
  const [preset, setPreset] = useState('');
  const [form, setForm] = useState(empty);
  const [cart, setCart] = useState<PriceInput[]>([]);
  const [error, setError] = useState<{ message: string; field?: keyof typeof empty }>();
  const [reviewed, setReviewed] = useState(false);
  const total = cart.reduce((sum, item) => sum + item.quantity, 0);
  const rows = cart.reduce((sum, item) => sum + Math.ceil(item.quantity / 3), 0);
  const [view, setView] = useState<'label' | 'zpl'>('label');
  const [dpmm, setDpmm] = useState(8);
  const [canvas, setCanvas] = useState<'strip' | '4x6'>('strip');
  const [row, setRow] = useState<'first' | 'last'>('first');
  const [rendered, setRendered] = useState<{ key: string; result: PricePreviewImage }>();
  let live: ReturnType<typeof generatePriceZpl> | undefined;
  try { live = generatePriceZpl({ ...form, quantity: Number(form.quantity) }); } catch { /* Formulário ainda incompleto. */ }
  const previewKey = JSON.stringify([live?.zpl, dpmm, canvas, row]);
  const image = rendered?.key === previewKey ? rendered.result : undefined;
  async function renderPreview() {
    if (!window.vinqueta || !live) return;
    const key = previewKey;
    const item = { ...form, quantity: Number(form.quantity) };
    await act('Renderizando ZPL no Labelary', async () => {
      const result = await window.vinqueta!.renderPricePreview({ item, dpmm, canvas, row, consent: true });
      if (!result.ok) throw new Error(result.error);
      setRendered({ key, result: result.data });
    });
  }
  function change(key: keyof typeof empty, value: string) {
    setForm(current => ({ ...current, [key]: value }));
    if (error?.field === key) setError(undefined);
    setReviewed(false);
  }
  function choose(id: string) {
    const reference = pricePresets.find(item => item.id === id);
    setPreset(id); setError(undefined); setReviewed(false);
    setForm(reference ? { name: reference.name, ean: reference.ean, price: reference.price, quantity: '3' } : empty);
  }
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(undefined);
    try {
      const input = { ...form, quantity: Number(form.quantity) };
      const item = validatePriceItem(input);
      if (cart.length >= 100 || total + item.quantity > MAX_PRICE_LABELS)
        throw new Error(`Limite do lote: 100 produtos e ${format(MAX_PRICE_LABELS)} etiquetas.`);
      setCart(current => [...current, { name: item.name, ean: item.ean,
        price: `${Math.floor(item.cents / 100)},${String(item.cents % 100).padStart(2, '0')}`, quantity: item.quantity }]);
      setReviewed(false);
    } catch (error) {
      const field = error instanceof PriceFieldError ? error.field : undefined;
      setError({ message: error instanceof Error ? error.message : 'Confira os dados do produto.', field });
      if (field) {
        const input = e.currentTarget.elements.namedItem(field);
        if (input instanceof HTMLInputElement) { input.focus(); shakeField(input); }
      }
    }
  }
  const invalid = (field: keyof typeof empty) => error?.field === field
    ? { 'aria-invalid': true as const, 'aria-describedby': 'price-input-error' } : {};
  async function generate() {
    if (!window.vinqueta || !reviewed || !cart.length) return;
    await act('Gerando etiquetas de preço', async () => {
      const result = await window.vinqueta!.generatePrices(cart);
      if (!result.ok) throw new Error(result.error);
      await onCreated(result.data);
      setCart([]); setReviewed(false);
    });
  }
  return <div className="price-workspace">
    <IntegrationPanel busy={busy} act={act} onAdd={items => {
      const incomingTotal = items.reduce((sum, item) => sum + item.quantity, 0);
      if (cart.length + items.length > 100 || total + incomingTotal > MAX_PRICE_LABELS)
        throw new Error(`O lote pode ter até 100 produtos e ${format(MAX_PRICE_LABELS)} etiquetas. Reduza a seleção ou as quantidades.`);
      setCart(current => [...current, ...items]); setReviewed(false);
    }} />
    <div className="price-info"><Tag size={18} /><span><strong>33 × 22 mm · 3 colunas · sem parcelas</strong>EAN em texto. A geração das etiquetas de preço é local.</span><span className="spec-badge">880 × 200 dots</span></div>
    <div className="price-layout">
      <section className="data-panel price-editor">
        <div className="section-heading"><Tag size={18} /><h2>Dados da etiqueta</h2></div>
        <form className="price-form" onSubmit={add} onInvalid={e => { if (e.target instanceof HTMLInputElement) shakeField(e.target); }}>
          <label htmlFor="price-preset">Produto dos modelos</label>
          <select id="price-preset" value={preset} onChange={e => choose(e.target.value)} disabled={!!busy}>
            <option value="">Novo produto</option>
            {pricePresets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {preset && <p className="reference-note">Este modelo usa dados fictícios. Preencha os dados reais antes de imprimir etiquetas de produção.</p>}
          <label htmlFor="price-name">Nome do produto</label>
          <input id="price-name" name="name" {...invalid('name')} value={form.name} onChange={e => change('name', e.target.value)} required maxLength={160} disabled={!!busy} placeholder="Nome para identificar o arquivo" />
          <span className="field-help">O nome organiza o lote; não é impresso na etiqueta.</span>
          <label htmlFor="price-ean">EAN-13</label>
          <input id="price-ean" name="ean" {...invalid('ean')} value={form.ean} onChange={e => change('ean', e.target.value)} inputMode="numeric" required maxLength={13} disabled={!!busy} placeholder="13 dígitos, com verificador" />
          <div className="price-inputs">
            <div><label htmlFor="price-value">Preço de venda (R$)</label><input id="price-value" name="price" {...invalid('price')} value={form.price} onChange={e => change('price', e.target.value)} inputMode="decimal" required disabled={!!busy} placeholder="49,99" /></div>
            <div><label htmlFor="price-quantity">Quantidade de etiquetas</label><input id="price-quantity" name="quantity" {...invalid('quantity')} type="number" min={1} max={MAX_PRICE_LABELS} step={1} value={form.quantity} onChange={e => change('quantity', e.target.value)} required disabled={!!busy} /></div>
          </div>
          <p className="field-help">Conte etiquetas individuais, não fileiras. Colunas restantes ficam em branco, sem arredondar a quantidade para cima.</p>
          {error && <p className="field-error" id="price-input-error" role="alert">{error.message}</p>}
          <button className="button secondary full" disabled={!!busy} type="submit"><Plus size={17} /> Adicionar ao lote</button>
        </form>
      </section>
      <SmoothCard className="data-panel price-preview-panel">
        <div className="section-heading"><FileCode2 size={18} /><h2>Conferência do modelo</h2><div className="view-switch" role="group" aria-label="Visualização da etiqueta">
          <button type="button" aria-pressed={view === 'label'} onClick={() => setView('label')}>Etiqueta</button>
          <button type="button" aria-pressed={view === 'zpl'} onClick={() => setView('zpl')}>ZPL</button>
        </div></div>
        {view === 'label' ? <div className="price-preview-ground">
          <div className="render-controls">
            <div><label htmlFor="preview-dpi">Resolução da prévia</label><select id="preview-dpi" value={dpmm} disabled={!!busy} onChange={e => setDpmm(Number(e.target.value))}><option value={6}>152 DPI · 6 dpmm</option><option value={8}>203 DPI · 8 dpmm</option><option value={12}>300 DPI · 12 dpmm</option><option value={24}>600 DPI · 24 dpmm</option></select></div>
            <div><label htmlFor="preview-canvas">Área de visualização</label><select id="preview-canvas" value={canvas} disabled={!!busy} onChange={e => setCanvas(e.target.value as 'strip' | '4x6')}><option value="strip">Faixa do ZPL · 880×200 dots</option><option value="4x6">Papel 4×6 polegadas</option></select></div>
            <div><label htmlFor="preview-row">Fileira</label><select id="preview-row" value={row} disabled={!!busy} onChange={e => setRow(e.target.value as 'first' | 'last')}><option value="first">Primeira</option><option value="last">Última (inclui sobras)</option></select></div>
          </div>
          {image ? <div className="rendered-zpl"><img src={image.image} width={image.pixelWidth} height={image.pixelHeight} alt="Etiqueta renderizada pelo Labelary a partir do ZPL gerado" /></div> :
            <div className="render-empty"><FileCode2 size={28} /><strong>{rendered ? 'Dados alterados: atualize a prévia' : 'Renderização do ZPL, sem imitação em HTML'}</strong><p>{live ? 'Clique abaixo para conferir a fonte e as posições usando o mesmo renderizador do Labelary.' : 'Preencha os dados da etiqueta para renderizar.'}</p></div>}
          <p className="render-consent">Ao clicar, você envia o ZPL desta fileira, com EAN e preço, ao serviço externo Labelary. Nenhuma senha ou sessão Havan é enviada. O serviço gratuito não garante retenção zero.</p>
          <button className="button secondary full" type="button" disabled={!live || !!busy || !window.vinqueta} onClick={renderPreview}><StateText text={image ? 'Atualizar prévia no Labelary' : 'Enviar e renderizar no Labelary'} /></button>
          <span className="preview-disclaimer">{image ? `PNG original do Labelary · ${image.pixelWidth}×${image.pixelHeight} pixels · ${image.dpi} DPI. ` : ''}Use a mesma resolução e área do site para comparar. A prévia mostra uma fileira sem repetir ^PQ; o arquivo de impressão não muda.</span>
          <div className="price-preview-facts">
            <div><span>Quantidade</span><strong>{live ? format(live.count) : '—'}</strong></div>
            <div><span>Fileiras</span><strong>{live ? format(live.rows) : '—'}</strong></div>
            <div><span>Vazias na última</span><strong>{live ? live.blankSlots : '—'}</strong></div>
          </div>
        </div> : <pre className="code-preview price-code">{live?.zpl || 'Preencha um EAN válido, preço e quantidade para conferir o ZPL.'}</pre>}
        <div className="price-profile-notes"><p><Check size={15} /> Layout de 2 ou 3 dígitos escolhido automaticamente.</p><p><Check size={15} /> Centavos preservados, inclusive “,90” e “,00”.</p><p><Check size={15} /> Sem deslocamento de volume e sem parcelas.</p></div>
        <p className="print-warning">Os modelos mantêm ^PW880 e ^LL200. Use a mesma resolução e calibração dos exemplos e faça um teste antes do lote completo.</p>
      </SmoothCard>
    </div>
    <SmoothCard className="data-panel price-cart">
      <div className="section-heading"><FileCode2 size={18} /><h2>Lote de preços</h2><span>{cart.length} produto(s) · {format(total)} etiquetas</span></div>
      {cart.length ? <><div className="table-scroll"><table><thead><tr><th>Produto</th><th>EAN</th><th>Preço</th><th>Etiquetas</th><th>Fileiras</th><th><span className="sr-only">Remover</span></th></tr></thead><tbody>{cart.map((item, i) => <tr key={i}><td><strong>{item.name}</strong></td><td className="mono">{item.ean}</td><td className="mono">R$ {item.price}</td><td>{format(item.quantity)}</td><td>{format(Math.ceil(item.quantity / 3))}</td><td><button className="icon-button" aria-label={`Remover ${item.name}`} disabled={!!busy} onClick={() => { setCart(current => current.filter((_, index) => index !== i)); setReviewed(false); }}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
        <div className="price-review"><label><AnimatedCheckbox checked={reviewed} disabled={!!busy} onChange={e => setReviewed(e.target.checked)} /><span>Conferi os EANs, os preços atuais e as quantidades deste lote.</span></label><span>Confira a origem e a versão do XML. Os produtos manuais usam os valores informados por você.</span></div>
        <div className="selection-bar"><div><strong>{format(total)} etiquetas · {format(rows)} fileiras</strong><span>Cada produto começa em uma fileira nova. Vários produtos são exportados em ZIP.</span></div><button className="button primary" disabled={!!busy || !reviewed || !window.vinqueta} onClick={generate}>Gerar lote de preços <ArrowRight size={17} /></button></div>
      </> : <div className="empty-state price-empty"><Tag size={26} /><h3>Adicione os produtos que quer imprimir</h3><p>Você poderá revisar preços e quantidades antes de gerar o lote.</p></div>}
      {!window.vinqueta && <p className="storage-note">A conferência funciona no navegador. Abra no Electron para salvar, exportar ou imprimir.</p>}
    </SmoothCard>
  </div>;
}
