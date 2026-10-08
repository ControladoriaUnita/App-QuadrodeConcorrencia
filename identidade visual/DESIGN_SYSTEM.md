# Unità Engenharia — Padrão Visual de Front-end

> Especificação visual oficial, extraída do **Painel de Obras** (`apps/web`) e dos arquivos de marca.
> Use este documento como referência para **todos os projetos web da Unità**.
> Versão 1.0 · outubro/2026 · Relatório visual completo: `docs/IDENTIDADE_VISUAL.html`

---

## 1. Princípios

1. **Laranja é acento, não fundo.** O laranja Unità marca ação, seleção e destaque. Superfícies grandes são brancas, neutras quentes ou grafite.
2. **Uma única fonte de tokens.** Toda cor, fonte, raio e sombra vem de `tokens.css`. Nunca escrever `#fe5000` (ou qualquer hex) dentro de um componente.
3. **Corporativo e denso.** Interface limpa, com cara de planilha financeira profissional: números alinhados à direita, `tabular-nums`, pouco ornamento.
4. **Neutros quentes.** A escala `ink` puxa levemente para o marrom para conversar com o preto da marca (`#231f20`) — não usar cinzas frios (slate/gray do Tailwind).
5. **Padrão brasileiro** em toda formatação (moeda, data, percentual, meses).

---

## 2. Logotipos e elementos de marca

| Arquivo (em `src/assets/brand/`) | Origem | Dimensões | Uso |
|---|---|---|---|
| `logo-unita.png` | `UNITÀ preto com assento laranja.png` | 918×355, PNG transparente | Logo principal sobre fundo claro (login, cadastro, relatórios, PDFs) |
| `logo-unita-white.png` | versão negativa do logo principal | 918×355, PNG transparente | Logo sobre fundo escuro (header grafite do app) |
| `symbol-un-orange.png` | `UN Laranja.png` | 834×413, PNG transparente | Símbolo "un" — empty states, marcas d'água, avatar |
| `symbol-un-black.png` | `UN Preto.png` | 378×187 | Símbolo em monocromia (impressão, fundos laranja) |
| `pattern-un.png` | `Diversos UN Laranja.png` | 3294×430 | Padrão gráfico de fundo (contorno laranja) |
| `public/favicon.png` | símbolo "un" | 64×64 | Favicon / ícone de aba |

### Regras de uso

- **Altura mínima do logo:** 28px em tela (`h-7`, header). Em telas de entrada (login), 48px (`h-12`).
- **Área de proteção:** no mínimo a altura do "à" ao redor do logo — nada de texto ou borda encostando.
- **Fundo claro → `logo-unita.png`. Fundo escuro → `logo-unita-white.png`.** Nunca aplicar o logo preto sobre grafite ou o branco sobre fundo claro.
- O acento do "à" é sempre laranja `#FE5000`. Não recolorir, não distorcer, não aplicar sombra/contorno.
- **Símbolo "un"** é usado sozinho apenas quando o logo completo já aparece na tela ou em espaços pequenos (favicon, empty state com `opacity: .3`).
- **Padrão "Diversos UN"** só como textura de fundo, com opacidade baixa (**7%** no login), sem interação (`pointer-events: none`, `aria-hidden`).
- `alt="Unità Engenharia"` no logo; imagens decorativas com `alt=""`.

---

## 3. Cores

### 3.1 Marca (extraídas dos arquivos oficiais)

| Token | Hex | Uso |
|---|---|---|
| `--color-brand-orange` | `#FE5000` | Acento do "à", símbolo "un" — **cor primária** |
| `--color-brand-orange-line` | `#F05426` | Traço do padrão gráfico "Diversos UN" |
| `--color-brand-black` | `#000000` | Logotipo UNITÀ |
| `--color-brand-ink` | `#231F20` | Símbolo "un" preto — **cor secundária** (header) |

### 3.2 Semânticas (o que os componentes usam)

| Token | Valor | Uso |
|---|---|---|
| `--color-primary` | `#FE5000` | Botão principal, links ativos, foco, borda do header |
| `--color-primary-hover` | `#E04700` | Hover do botão principal |
| `--color-primary-soft` | `#FFF1EA` | Fundo de item selecionado, badge primário, mês atual na grade |
| `--color-primary-foreground` | `#FFFFFF` | Texto sobre primária |
| `--color-secondary` | `#231F20` | Header/top bar, linha "acumulado" dos gráficos |
| `--color-secondary-foreground` | `#FFFFFF` | Texto sobre secundária |
| `--color-background` | `#F8F7F6` (ink-50) | Fundo da página |
| `--color-surface` | `#FFFFFF` | Cards, tabelas, inputs, modais |
| `--color-border` | `#E2DFDC` (ink-200) | Bordas e divisórias |
| `--color-text` | `#1A1817` (ink-900) | Texto principal |
| `--color-text-muted` | `#77716D` (ink-500) | Texto secundário, labels, legendas |

### 3.3 Escala neutra quente (`ink`)

| 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|---|
| `#F8F7F6` | `#F0EEEC` | `#E2DFDC` | `#C9C4C0` | `#A19B96` | `#77716D` | `#57524F` | `#3D3937` | `#2B2827` | `#1A1817` |

Guia rápido: **50** fundo · **100** hover/skeleton/disabled · **200** borda · **300** texto inativo no header · **400** placeholder · **500** texto secundário · **600** texto de corpo em modais/menus · **700** labels · **900** texto principal.

### 3.4 Status (feedback)

| Tom | Cor forte | Fundo suave | Uso |
|---|---|---|---|
| `success` | `#1E8A4C` | `#E7F5EC` | OK, ativa, curva própria |
| `warning` | `#B7791F` | `#FDF4E3` | Atenção, arquivada, aguardando API |
| `error` | `#C62828` | `#FDECEC` | Erro, atrasada, prejuízo, ação destrutiva |
| `info` | `#2563A8` | `#E8F0FA` | Informação, concluída |

Padrão de composição: **fundo suave + texto na cor forte** (badges) e **borda da cor forte a 30% + fundo suave** (alerts).

### 3.5 Cores específicas da grade de projeção

| Token | Hex | Significado |
|---|---|---|
| `--color-cell-manual` | `#FFF4D6` | Célula ajustada manualmente (origem `MANUAL`) |
| `--color-cell-issued` | `#E7F5EC` | Taxa emitida no mês (origem `ISSUED`) |
| `--color-cell-current-period` | `#FFF1EA` | Coluna do mês de referência/atual |

### 3.6 Contraste (WCAG 2.1)

| Combinação | Razão | Resultado |
|---|---|---|
| ink-900 sobre branco | 17,7:1 | AAA |
| ink-500 (muted) sobre branco | 4,8:1 | AA |
| ink-500 sobre ink-50 | 4,5:1 | AA (limite) |
| branco sobre `#231F20` (header) | 16,3:1 | AAA |
| laranja sobre `#231F20` | 4,9:1 | AA |
| **branco sobre laranja `#FE5000`** | **3,3:1** | **AA só p/ texto grande/negrito ≥ 18,7px** |
| branco sobre `#E04700` (hover) | 4,1:1 | AA texto grande |
| laranja sobre branco | 3,3:1 | Só títulos/ícones, **não** texto corrido |

> **Recomendação:** não usar laranja para texto pequeno sobre fundo claro (exceto eyebrows em CAIXA ALTA semibold, que já é o padrão). Para novos projetos com exigência de acessibilidade AA estrita em botões, considere `#D94400` como `--color-primary` de texto/botão mantendo `#FE5000` para marca.

---

## 4. Tipografia

| Papel | Família | Pesos carregados | Onde |
|---|---|---|---|
| **Display** (`--font-display`) | **Sora** | 500, 600, 700 | `h1`, `h2`, `h3` |
| **Texto / UI** (`--font-sans`) | **Inter** | 400, 500, 600, 700 | Corpo, botões, tabelas, formulários |

Fallback: `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`.

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap" rel="stylesheet" />
```

### Escala tipográfica

| Uso | Classe Tailwind | Tamanho | Peso |
|---|---|---|---|
| Título da página | `text-2xl font-semibold` | 24px | 600 (Sora) |
| Título de tela de login / obra | `text-xl font-semibold` | 20px | 600 (Sora) |
| Título de modal | `text-lg font-semibold` | 18px | 600 |
| Valor de KPI | `text-lg font-semibold tabular` | 18px | 600 |
| Título de card | `text-base font-semibold` | 16px | 600 |
| Corpo / botões / inputs / tabelas | `text-sm` | 14px | 400–500 |
| Labels de formulário | `text-sm font-medium text-ink-700` | 14px | 500 |
| Labels de KPI, hints, badges, cabeçalho de grade | `text-xs` | 12px | 500–600 |
| Eyebrow (sobretítulo) | `text-xs font-semibold uppercase tracking-wider text-primary` | 12px | 600 |
| Sub-linha de célula | `text-[11px] leading-4 text-text-muted` | 11px | 400 |

**Números:** sempre `font-variant-numeric: tabular-nums` (utilitário `tabular`) em tabelas, KPIs e grades; alinhados à direita.

---

## 5. Espaçamento, raio, sombra

- **Grid base de 4px** (escala padrão do Tailwind). Padrões recorrentes:
  - Gutter da página: `px-4` → `lg:px-6` → `2xl:px-10`; `py-6` vertical.
  - Padding de card: `px-5 py-4` (header) · `p-8` (card de login) · `px-4 py-3` (KPI).
  - Gap entre KPIs/cards: `gap-3`; entre seções: `gap-6`; abaixo do PageHeader: `mb-6`.
  - Células da grade: `px-3 py-2`; primeira coluna `px-4 py-2`.

| Token | Valor | Uso |
|---|---|---|
| `--radius-control` | `0.5rem` (8px) | Botões, inputs, alerts, itens de menu, skeleton |
| `--radius-card` | `0.875rem` (14px) | Cards, modais, container da grade |
| `rounded-full` | 9999px | Badges, spinner |
| `--shadow-card` | `0 1px 2px rgb(26 24 23/.06), 0 1px 3px rgb(26 24 23/.08)` | Cards |
| `--shadow-overlay` | `0 10px 30px rgb(26 24 23/.18)` | Modais, popovers |

Bordas: **1px `--color-border`** em tudo; exceção — header tem `border-bottom: 2px solid var(--color-primary)`.

**Foco:** `outline: 2px solid var(--color-primary); outline-offset: 2px` global (`:focus-visible`). Inputs: borda primária + `ring-2 ring-primary/20`.

---

## 6. Componentes

### Botão (`Button`)
Base: `inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed`

| Variante | Estilo | Quando |
|---|---|---|
| `primary` | fundo laranja, texto branco, hover `#E04700` | 1 ação principal por tela |
| `secondary` | fundo branco, borda, hover ink-100 | Ações secundárias |
| `ghost` | sem fundo, hover ink-100 | Cancelar, ações terciárias |
| `danger` | fundo `error`, texto branco | Excluir/sobrescrever |
| `inverse` | texto ink-200, hover `white/10` | Sobre o header escuro |

Tamanhos: `sm` = 32px altura (`h-8 px-3`) · `md` = 40px (`h-10 px-4`). Estado `loading` troca o ícone por spinner e desabilita.

### Inputs (`Input`, `Select`, `Textarea`)
Altura 40px, `rounded-control`, borda `border`, fundo `surface`, placeholder ink-400, foco borda laranja + ring 20%, disabled fundo ink-100, inválido (`aria-invalid`) borda `error`.
`Field` = label (`text-sm font-medium text-ink-700`) + controle + hint (`text-xs muted`) ou erro (`text-xs text-error`), `gap-1.5`, com `aria-describedby`.

### Card
`rounded-card border border-border bg-surface shadow-card`. `CardHeader`: título `text-base font-semibold`, descrição `text-sm muted`, ações à direita, `border-b`.

### Badge
Pílula `rounded-full px-2 py-0.5 text-xs font-medium` — tons `neutral | primary | success | warning | error | info` (fundo suave + texto forte).

### Alert
`rounded-control border px-4 py-3 text-sm` com tom de status; título `font-semibold`; `role="alert"` para erro, `status` para os demais.

### Modal (`ConfirmDialog`)
`<dialog>` nativo, largura `min(92vw, 30rem)`, `rounded-card shadow-overlay`, backdrop `ink-900/40`. Rodapé `bg-ink-50 border-t` com **Cancelar (ghost)** à esquerda das ações; ação destrutiva em `danger`.

### Estados de carregamento e vazio
- `Skeleton`: `animate-pulse rounded-control bg-ink-100`.
- `Spinner`: círculo 20px `border-2 border-current border-r-transparent animate-spin`.
- `EmptyState`: símbolo "un" laranja 32px a 30% de opacidade + título + descrição + ação, centralizado, `py-14`.

### Status de domínio (mapeamento para tons)
| Obra | Tom | | Curva da obra | Tom |
|---|---|---|---|---|
| Rascunho | neutral | | Não iniciada | neutral |
| Não iniciada | primary | | Curva própria | success |
| Ativa | success | | Aguardando API | warning |
| Concluída | info | | Paramétrica | neutral |
| Arquivada | warning | | | |

---

## 7. Layout

### App shell
- **Header fixo** (`sticky top-0 z-30`), altura **56px**, fundo **grafite `#231F20`**, **borda inferior laranja de 2px**.
- Logo branco 28px à esquerda → navegação principal (links `text-sm font-medium`; ativo `bg-white/10 text-white`; inativo `text-ink-300 hover:text-white`) → usuário + papel + botão **Sair** (`inverse`) à direita.
- Conteúdo em largura total com gutters responsivos.

### PageHeader
Eyebrow laranja opcional → `h1` 24px → descrição muted; ações alinhadas à direita na mesma linha (quebram em telas pequenas).

### Sidebar de detalhe (ex.: tela da obra)
Largura `240px` em `lg+`; vira abas horizontais roláveis abaixo disso. Item ativo: `bg-primary-soft text-primary` + **borda esquerda laranja de 2px**; inativo `text-ink-600 hover:bg-ink-100`.

### Tela de autenticação
Fundo `background` com padrão "Diversos UN" a 7% no rodapé; logo 48px centralizado; card `max-w-md p-8`.

### Breakpoints (Tailwind padrão)
`sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`. **Desktop-first** para análise; tablet funcional; mobile com navegação básica e scroll horizontal nas grades.

---

## 8. Grade estilo planilha (padrão para tabelas financeiras)

- Meses no **eixo X**, itens no **eixo Y**; container `rounded-card border overflow-auto`, `max-h-[60vh]`.
- `border-separate border-spacing-0`, fonte `text-sm tabular`.
- **Cabeçalho fixo** (`sticky top-0`) fundo ink-50, `text-xs font-semibold`, texto muted, alinhado à direita.
- **Primeira coluna congelada** (`sticky left-0`), `min-w-56`, fundo surface.
- Colunas de mês `min-w-32`; coluna **TOTAL** `min-w-36`, fundo ink-50/ink-100, `font-semibold`, borda esquerda.
- **Mês atual/referência:** cabeçalho `bg-cell-current-period text-primary`; células com o mesmo fundo a 60%.
- **Hover de linha:** `group-hover:bg-ink-50`.
- **Origem da célula:** manual → `cell-manual` (amarelo claro); emitida → `cell-issued` (verde claro); tooltip informa origem e valor original da curva.
- Linhas principais `font-medium`; linhas derivadas (acumulados) em `text-muted`.
- Ausência de valor: **`—`** (travessão).

---

## 9. Gráficos (Recharts)

- Cores lidas dos tokens em runtime via `resolveColors()` — nunca hex fixo.
- **Série mensal = barras laranja** (`primary`), raio superior 3px, `maxBarSize 28`.
- **Série acumulada = linha grafite** (`secondary`), 2px, `monotone`, sem pontos.
- Grade só horizontal (`ink-200`); eixos sem tick lines; rótulos `text-muted` 12px Inter.
- Tooltip com `border-radius: 8px` e borda `border`. Percentuais em pt-BR.
- Para mais séries: laranja → grafite → info `#2563A8` → success `#1E8A4C` → ink-400.

---

## 10. Formatação de dados (pt-BR)

| Tipo | Formato | Exemplo |
|---|---|---|
| Moeda | `Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'})` | `R$ 1.234.567,89` |
| Percentual | 2 casas (1 em tabelas densas) | `12,35%` |
| Variação | sinal explícito | `+3,2%` / `-1,5%` |
| Data | `dd/mm/aaaa` (sem `Date` → sem fuso) | `01/09/2026` |
| Data e hora | `dateStyle/timeStyle: short` | `28/09/2026 10:32` |
| Mês | `MMM/AA` em caixa alta | `JAN/27` |
| Vazio | travessão | `—` |

Entrada do usuário: aceitar `1.234,56`, `1234,56`, `R$ 150.000` (= cento e cinquenta mil) e converter com aritmética de string — sem `float`.

---

## 11. Tom e microcopy

- Português do Brasil, frases curtas, voz ativa. Botões com verbo: **Salvar**, **Recalcular**, **Nova obra**, **Sair**.
- Confirmações destrutivas explicam a consequência e oferecem saída: *"Existem 7 valores ajustados manualmente. Deseja recalcular e substituir esses ajustes?"* → Cancelar · Preservar ajustes · Substituir.
- Papéis: Administrador · Editor · Visualizador.

---

## 12. Tokens prontos para copiar (Tailwind v4)

Arquivo `src/styles/tokens.css`:

```css
@theme static {
  /* Brand */
  --color-brand-orange: #fe5000;
  --color-brand-orange-line: #f05426;
  --color-brand-black: #000000;
  --color-brand-ink: #231f20;

  /* Semantic */
  --color-primary: var(--color-brand-orange);
  --color-primary-hover: #e04700;
  --color-primary-soft: #fff1ea;
  --color-primary-foreground: #ffffff;
  --color-secondary: var(--color-brand-ink);
  --color-secondary-foreground: #ffffff;

  /* Neutral (warm) */
  --color-ink-50: #f8f7f6;
  --color-ink-100: #f0eeec;
  --color-ink-200: #e2dfdc;
  --color-ink-300: #c9c4c0;
  --color-ink-400: #a19b96;
  --color-ink-500: #77716d;
  --color-ink-600: #57524f;
  --color-ink-700: #3d3937;
  --color-ink-800: #2b2827;
  --color-ink-900: #1a1817;

  --color-background: var(--color-ink-50);
  --color-surface: #ffffff;
  --color-border: var(--color-ink-200);
  --color-text: var(--color-ink-900);
  --color-text-muted: var(--color-ink-500);

  --color-success: #1e8a4c;  --color-success-soft: #e7f5ec;
  --color-warning: #b7791f;  --color-warning-soft: #fdf4e3;
  --color-error: #c62828;    --color-error-soft: #fdecec;
  --color-info: #2563a8;     --color-info-soft: #e8f0fa;

  /* Grid */
  --color-cell-manual: #fff4d6;
  --color-cell-issued: #e7f5ec;
  --color-cell-current-period: #fff1ea;

  /* Typography */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Sora', 'Inter', ui-sans-serif, system-ui, sans-serif;

  /* Radius & shadows */
  --radius-control: 0.5rem;
  --radius-card: 0.875rem;
  --shadow-card: 0 1px 2px rgb(26 24 23 / 0.06), 0 1px 3px rgb(26 24 23 / 0.08);
  --shadow-overlay: 0 10px 30px rgb(26 24 23 / 0.18);
}
```

Base global (`src/styles/index.css`):

```css
@import 'tailwindcss';
@import './tokens.css';

@layer base {
  html, body, #root { height: 100%; }
  body {
    background: var(--color-background);
    color: var(--color-text);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3 { font-family: var(--font-display); }
  :focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
}

@utility tabular { font-variant-numeric: tabular-nums; }
```

`index.html`: `lang="pt-BR"`, `<meta name="theme-color" content="#FE5000">`, favicon do símbolo "un".

### Fora do Tailwind (CSS puro / outros frameworks)
Os mesmos nomes funcionam como variáveis CSS comuns: troque `@theme static {` por `:root {` e use `var(--color-primary)` etc.

---

## 13. Stack de referência

React 19 · TypeScript (strict) · Vite 7 · Tailwind CSS 4 (`@tailwindcss/vite`) · Recharts 3 · React Hook Form + Zod · TanStack Query · utilitário `cn()` para compor classes. Componentes próprios em `components/ui` (sem biblioteca de UI externa) — copiar a pasta para novos projetos.

## 14. Checklist para um novo projeto Unità

- [ ] Copiar `src/assets/brand/` e `public/favicon.png`
- [ ] Copiar `tokens.css`, `index.css`, `constants/tokens.ts`, `utils/cn.ts`, `utils/format.ts`
- [ ] Copiar `components/ui/` e `components/layout/`
- [ ] Carregar Inter + Sora; `lang="pt-BR"`; `theme-color #FE5000`
- [ ] Header grafite com borda laranja 2px e logo branco
- [ ] Nenhum hex fora de `tokens.css` (`grep -r "#[0-9a-f]\{6\}" src --include=*.tsx` deve vir vazio)
