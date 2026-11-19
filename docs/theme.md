# Aparência da Central

## Implementação

- **React + CSS custom properties**, sem Tailwind ou dependências adicionais.
- `data-theme="light|dark"` em `<html>` e `color-scheme` para controles nativos.
- Preferência `light|dark|system` no contexto React; `resolvedTheme` é o tema aplicado.
- `localStorage["vinqueta.theme"]` persiste a escolha. O padrão é acompanhar o sistema.
- Alterações do sistema são observadas via `matchMedia`, com remoção do listener.
- O script externo **síncrono** `public/theme-init.js` aplica o tema antes do React
  e das folhas de estilo. Não usa inline script, `unsafe-inline` nem reduz a CSP.
- A janela Electron só aparece em `ready-to-show`, evitando uma janela clara vazia.
- Transições de cores duram 200 ms apenas durante a troca de tema; a classe é
  removida em 300 ms. `prefers-reduced-motion` elimina as transições.
- Falhas no armazenamento não impedem a interface de funcionar.

## Paleta principal

As cores estão centralizadas em `src/styles.css`: 34 tokens de cor e dois de
sombra. As cores de papel permanecem constantes nos dois temas.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--page` | `#f3f3f3` | `#151b18` | Fundo |
| `--surface` | `#ffffff` | `#1e2722` | Painéis e navegação |
| `--elevated` | `#ffffff` | `#29352e` | Modais e campos |
| `--ink` | `#232323` | `#e4ebe6` | Texto principal |
| `--muted` | `#626962` | `#b0bfb4` | Texto secundário |
| `--deep` | `#143b2b` | `#9bd4b2` | Botão principal |
| `--on-primary` | `#ffffff` | `#132c20` | Texto do botão principal |
| `--line` | `#dfe5e0` | `#3c5043` | Divisórias |
| `--focus` | `#267747` | `#a1dfb9` | Foco de teclado |
| `--paper-bg` | `#ffffff` | `#ffffff` | Papel da etiqueta |

O modo escuro usa superfícies progressivamente mais claras para elevação,
bordas em vez de sombras fortes e verdes menos saturados. Não há inversão ou
filtro aplicado à tela, às imagens do Labelary ou aos dados de impressão.

## Contraste WCAG AA

Os testes verificam 30 pares de texto e seis pares de foco/controles em cada tema:
4,5:1 para texto e 3:1 para indicadores de foco e bordas de controles.
Controles desabilitados são excluídos da verificação de texto renderizado.

| Par | Claro | Escuro |
|---|---|---|
| Texto principal / fundo | 14,16:1 | 14,42:1 |
| Texto secundário / painel | 5,65:1 | 8,01:1 |
| Texto secundário / modal | 5,65:1 | 6,67:1 |
| Botão principal | 12,42:1 | 8,84:1 |
| Placeholder / campo | 4,83:1 | 6,40:1 |
| Foco / painel | 5,51:1 | 10,06:1 |
| Sucesso | 7,15:1 | 8,14:1 |
| Aviso | 6,85:1 | 7,91:1 |
| Erro | 7,16:1 | 7,94:1 |

## Verificação

```bash
npm run check
npm run test:desktop
# Em outro terminal:
npm run dev -- --port 5174
npm run test:theme
VINQUETA_UI_URL=http://127.0.0.1:5174 npm run test:ui
```

- `tests/theme.test.mjs`: contraste, tokens e bootstrap sem React, inclusive
  preferência inválida e armazenamento indisponível.
- `scripts/check-theme.mjs`: temas claro/escuro em configurações, login, preços
  e histórico a 1440, 1024, 768 e 390 px, sem overflow; contraste do texto real;
  preferência do sistema ao vivo, escolha manual, reload e papel branco.
- `scripts/smoke-desktop.mjs`: operações existentes e modais em modo escuro,
  preferência mantida após recarregar e reiniciar o Electron com perfil temporário.

As capturas de verificação ficam em `test-results/theme-*.png` e
`test-results/desktop-*.png`. As verificações não usam credenciais reais.
