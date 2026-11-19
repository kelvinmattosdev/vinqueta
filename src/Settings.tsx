import { Monitor, Moon, SlidersHorizontal, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

type Props = { busy: string; canReset: boolean; onResetWarnings: () => void };
const choices = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: Monitor },
] as const;
export default function Settings({ busy, canReset, onResetWarnings }: Props) {
  const { theme, resolvedTheme, setTheme, persistent } = useTheme();
  return <div className="settings-workspace">
    <section className="data-panel">
      <div className="section-heading"><Moon size={18} /><h2>Aparência</h2></div>
      <div className="settings-body">
        <p>Escolha o tema da Central. A aparência das etiquetas e os arquivos de impressão não mudam.</p>
        <fieldset className="theme-choices"><legend className="sr-only">Tema do aplicativo</legend>
          <div className="theme-track" data-choice={theme}>
            <span className="theme-pill" aria-hidden="true" />
            {choices.map(({ value, label, Icon }) => <label className="theme-choice" key={value}>
              <input type="radio" name="theme" value={value} checked={theme === value}
                aria-label={value === 'system' ? 'Seguir o sistema' : undefined} onChange={() => setTheme(value)} />
              <Icon size={16} aria-hidden="true" /><span>{label}</span>
            </label>)}
          </div>
        </fieldset>
        <p className="field-help" role="status">Tema atual: {resolvedTheme === 'dark' ? 'escuro' : 'claro'}. {persistent ? 'Sua escolha é salva neste computador.' : 'Não foi possível salvar a preferência; ela vale apenas nesta sessão.'}</p>
      </div>
    </section>
    <section className="data-panel">
      <div className="section-heading"><SlidersHorizontal size={18} /><h2>Avisos de confirmação</h2></div>
      <div className="settings-body">
        <p>Volte a exibir os avisos de download de integração, geração de volumes e envio à impressora.</p>
        <button className="button secondary" disabled={!!busy || !canReset} onClick={onResetWarnings}>Restaurar avisos</button>
      </div>
    </section>
  </div>;
}
