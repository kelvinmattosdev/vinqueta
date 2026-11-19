import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  persistent: boolean;
};
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark' || value === 'system';
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('vinqueta.theme') || localStorage.getItem('jau.theme');
    return isTheme(saved) ? saved : 'system';
  } catch { return 'system'; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(initialTheme);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [persistent, setPersistent] = useState(true);
  const mounted = useRef(false);
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    changed();
    media.addEventListener('change', changed);
    const storage = (event: StorageEvent) => {
      if (event.key === 'vinqueta.theme') updateTheme(isTheme(event.newValue) ? event.newValue : 'system');
    };
    window.addEventListener('storage', storage);
    return () => {
      media.removeEventListener('change', changed);
      window.removeEventListener('storage', storage);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const changed = root.dataset.theme !== resolvedTheme;
    if (mounted.current && changed) root.classList.add('theme-transitioning');
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#151b18' : '#f3f3f3');
    mounted.current = true;
    const timeout = window.setTimeout(() => root.classList.remove('theme-transitioning'), 300);
    return () => { window.clearTimeout(timeout); root.classList.remove('theme-transitioning'); };
  }, [resolvedTheme]);

  function setTheme(next: Theme) {
    if (!isTheme(next)) return;
    updateTheme(next);
    try { localStorage.setItem('vinqueta.theme', next); setPersistent(true); }
    catch { setPersistent(false); }
  }
  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, persistent,
    toggleTheme: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark') }}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('Tema indisponível fora do provedor.');
  return value;
}
