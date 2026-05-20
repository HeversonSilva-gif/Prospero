# M16 PR-A1 — Sidebar Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir a barra lateral de 11 → 5 itens ("Início · Pedir algo · Projetos · Minha equipe · Ajustes") com ícones SVG line, em linguagem comum. Extrair `Sidebar` da inline declaration em `App.tsx` pra componente próprio. Remover a lista de agentes do sidebar. Manter todas as rotas existentes funcionando (regressão zero).

**Architecture:** Componente extraído `Sidebar.tsx` em `apps/renderer/src/components/layout/` com 5 NavLinks usando ícones SVG inline + 5 chaves i18n novas (`nav.inicio` · `nav.pedirAlgo` · `nav.projetos` · `nav.equipe` · `nav.ajustes`). Cada link aponta pra uma rota existente (sem mudanças de routing): Início→`/briefing` · Pedir algo→`/goals/new` · Projetos→`/projects` · Minha equipe→`/agents` · Ajustes→`/settings`. App.tsx perde a Sidebar inline (-180 linhas) e importa o novo componente.

**Tech Stack:** React 18 · React Router v6 (HashRouter) · react-i18next · Tailwind · TypeScript strict · inline SVG (line icons, ~24×24 viewBox) — sem icon library nova (codebase já usa SVG inline, ver `apps/renderer/src/components/routines/RoutineHistory.tsx`).

**Spec:** `docs/superpowers/specs/2026-05-18-m16-interface-redesign-design.md` (§4, §13). Mockup: `docs/m16-mockups/shell-navigation-hifi.html`. Base de execução: HEAD `bb17eaf` (M15 PR-C close).

**Scope deliberadamente limitado:** SÓ o sidebar/ícones/nav i18n. Vocabulário profundo (`agent → funcionário`, `issue → tarefa`, etc.) NÃO faz parte deste PR — fica pareado com cada PR de tela (B, C, D, E, F) ou num PR-A2 separado depois.

---

## File map

**Criados (renderer, 2):**
- `apps/renderer/src/components/layout/Sidebar.tsx` — novo componente Sidebar com 5 NavLinks + CompanySwitcher + SidebarFooter.
- `apps/renderer/src/components/layout/sidebar-icons.tsx` — 5 ícones SVG inline (Home, Sparkles, Folder, Users, Settings).

**Modificados (renderer, 3):**
- `apps/renderer/src/App.tsx` — remove a Sidebar inline (linhas 50-228), importa o novo `<Sidebar />` de `./components/layout/Sidebar.js`. Remove `useAgentsStore`/`useInboxStore`/`STATUS_COLOR` se forem usados APENAS pela sidebar removida.
- `apps/renderer/src/i18n/en-US.json` — 5 chaves novas no bloco `nav.*`.
- `apps/renderer/src/i18n/pt-BR.json` — 5 chaves novas no bloco `nav.*`.

**Total:** 2 criados + 3 modificados = 5 arquivos.

---

## Conventions

- Sempre rodar `pnpm typecheck` antes de commitar — vitest com esbuild não pega type holes (lesson [[project-m14-pr-a-lessons]]).
- Antes do commit final de cada task: `git status --short` + `git diff HEAD --stat` para confirmar disk == staged == HEAD.
- Pre-commit hook reformata (prettier) + eslint-fix + gitleaks.
- Commits lowercase, sem `+`/`%`, ≤72 chars (commitlint).
- Nunca `--no-verify`.
- **Sem emojis na UI** — ícones SVG inline. Regra hard do usuário [[feedback-no-emojis]].
- Identidade visual preservada: Poppins, azul `#1d5dd7` (token `brand`), fundo `#f5f5fa` (token `surface`), cantos arredondados. Spec §6.
- Active state: `bg-brand-bg text-brand` (já é o padrão do código atual).

### Comandos

Pasta raiz: `D:\Projetos pessoais\DashboardAgent`. PowerShell.

- Tests renderer único: `cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"; npx vitest run <relative-path>`
- Tests full renderer: `pnpm --filter @prospero/renderer test`
- Typecheck workspace: `pnpm typecheck`
- Lint: `pnpm lint`

---

## Task 1: i18n keys — 5 chaves nav novas (pt + en)

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

Context: adicionar 5 chaves novas no bloco `nav.*` em ambos os locales. As chaves existentes (`nav.briefing`, `nav.dashboard`, `nav.inbox`, `nav.projects`, `nav.issues`, `nav.agents`, `nav.goals`, `nav.orgChart`, `nav.roles`, `nav.telos`, `nav.costs`, `nav.activity`, `nav.settings`, `nav.routines`) FICAM no JSON — viram dead keys após este PR mas não são removidas (limpeza fica pra PR-G ou um PR-A2 futuro de vocab). Parity test em `apps/renderer/src/i18n/parity.test.ts` continua passando porque adicionamos as mesmas chaves nos 2 locales.

- [ ] **Step 1: Add new nav keys to `en-US.json`**

Open `apps/renderer/src/i18n/en-US.json`. Find the `"nav": { ... }` block near the top. INSIDE the `nav` object, add 5 new keys (place them at the end of the block, before the closing `}`):

```json
    "inicio": "Home",
    "pedirAlgo": "Ask for something",
    "projetos": "Projects",
    "equipe": "My team",
    "ajustes": "Settings",
```

(Don't forget the comma after the previous last key.)

- [ ] **Step 2: Mirror in `pt-BR.json`**

Open `apps/renderer/src/i18n/pt-BR.json`. Find the `"nav": { ... }` block. Add INSIDE it:

```json
    "inicio": "Início",
    "pedirAlgo": "Pedir algo",
    "projetos": "Projetos",
    "equipe": "Minha equipe",
    "ajustes": "Ajustes",
```

- [ ] **Step 3: Run parity test**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/i18n/parity.test.ts
```

Expected: pass (en/pt symmetric on the new keys).

- [ ] **Step 4: Typecheck + renderer tests**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm --filter @prospero/renderer test
```

Expected: all green. Test count unchanged.

- [ ] **Step 5: Commit**

```powershell
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(m16): add new sidebar i18n keys"
```

---

## Task 2: Sidebar SVG icons module

**Files:**
- Create: `apps/renderer/src/components/layout/sidebar-icons.tsx`

Context: 5 ícones SVG line, viewBox 24×24, `stroke="currentColor"` para herdar a cor do texto da NavLink (azul no active, ink-muted no idle). Inline paths estilo Lucide. Não usar nenhuma biblioteca de ícones — o codebase usa SVG inline em todo lugar (lesson [[feedback-no-emojis]]).

- [ ] **Step 1: Create the icons module**

Create `apps/renderer/src/components/layout/sidebar-icons.tsx` with EXACTLY:

```typescript
import type { FC } from "react";

// M16 PR-A1 — line icons inline para a sidebar.
// 24x24 viewBox, stroke currentColor. Estilo Lucide line.
// Sem dependência de icon library — o codebase usa SVG inline.

type IconProps = {
  className?: string;
};

const SIZE = 20;
const COMMON_PROPS = {
  width: SIZE,
  height: SIZE,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const HomeIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <path d="M3 11 L12 4 L21 11" />
    <path d="M5 10 L5 20 L19 20 L19 10" />
    <path d="M10 20 L10 14 L14 14 L14 20" />
  </svg>
);

export const SparklesIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <path d="M12 3 L13.5 8.5 L19 10 L13.5 11.5 L12 17 L10.5 11.5 L5 10 L10.5 8.5 Z" />
    <path d="M18 16 L18.7 18.3 L21 19 L18.7 19.7 L18 22 L17.3 19.7 L15 19 L17.3 18.3 Z" />
  </svg>
);

export const FolderIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <path d="M3 7 L3 19 A1 1 0 0 0 4 20 L20 20 A1 1 0 0 0 21 19 L21 9 A1 1 0 0 0 20 8 L11 8 L9 6 L4 6 A1 1 0 0 0 3 7 Z" />
  </svg>
);

export const UsersIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20 C3 16 5.5 14 9 14 C12.5 14 15 16 15 20" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M17 13.5 C19.5 13.5 21 15 21 17.5" />
  </svg>
);

export const SettingsIcon: FC<IconProps> = ({ className }) => (
  <svg {...COMMON_PROPS} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2 L12 5 M12 19 L12 22 M2 12 L5 12 M19 12 L22 12 M4.93 4.93 L7.05 7.05 M16.95 16.95 L19.07 19.07 M4.93 19.07 L7.05 16.95 M16.95 7.05 L19.07 4.93" />
  </svg>
);
```

- [ ] **Step 2: Typecheck + lint**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
```

Expected: green.

- [ ] **Step 3: Commit**

```powershell
git add apps/renderer/src/components/layout/sidebar-icons.tsx
git commit -m "feat(m16): add sidebar svg line icons"
```

---

## Task 3: Sidebar component

**Files:**
- Create: `apps/renderer/src/components/layout/Sidebar.tsx`

Context: novo componente que substitui a Sidebar inline em App.tsx. Estrutura: app title + CompanySwitcher + 5 NavLinks (cada um com ícone SVG + label i18n) + SidebarFooter no rodapé. SEM a lista de agentes (removida nesta PR; agentes vivem em Minha equipe).

Padrão de active state matchando o atual: `bg-brand-bg text-brand` (azul) quando ativo; `hover:bg-surface-soft` quando idle.

Para roteamento:
- Início → `/briefing` (M14 Vitrine = Início per spec §17)
- Pedir algo → `/goals/new` (existing route, abre o GoalNew form)
- Projetos → `/projects` (existing)
- Minha equipe → `/agents` (existing — `end` modifier mantém active state mesmo em `/agents/:id`? Confirmar — no current code o NavLink de /agents usa `end` prop)
- Ajustes → `/settings` (existing)

A spec §4 diz: "Mantém a janela frameless (TitleBar atual) e o CompanySwitcher". O TitleBar fica no Shell (não na Sidebar). O CompanySwitcher fica no topo da Sidebar (atual padrão preservado).

A spec §4 diz também: "A lista de agentes que hoje fica na barra sai — agentes vivem em Minha equipe". Confirmar essa remoção: o novo Sidebar NÃO renderiza `useAgentsStore` nem agent NavLinks.

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/components/layout/Sidebar.tsx` with EXACTLY:

```typescript
import type { FC } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CompanySwitcher } from "../CompanySwitcher.js";
import { SidebarFooter } from "../SidebarFooter.js";
import {
  HomeIcon,
  SparklesIcon,
  FolderIcon,
  UsersIcon,
  SettingsIcon,
} from "./sidebar-icons.js";

// M16 PR-A1 — sidebar reduzida de 11 para 5 itens.
// Não renderiza a lista de agentes (agentes vivem em "Minha equipe" agora).
// Routes apontam para superfícies existentes — sem alteração de roteamento neste PR.

type NavItem = {
  to: string;
  labelKey: string;
  Icon: FC<{ className?: string }>;
  end?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/briefing", labelKey: "nav.inicio", Icon: HomeIcon },
  { to: "/goals/new", labelKey: "nav.pedirAlgo", Icon: SparklesIcon },
  { to: "/projects", labelKey: "nav.projetos", Icon: FolderIcon },
  { to: "/agents", labelKey: "nav.equipe", Icon: UsersIcon, end: true },
  { to: "/settings", labelKey: "nav.ajustes", Icon: SettingsIcon },
];

export const Sidebar: FC = () => {
  const { t } = useTranslation();
  return (
    <aside className="w-56 bg-surface border-r border-surface-border flex flex-col p-3">
      <h1 className="px-2 mb-4 text-sm font-bold text-brand-dark">{t("app.title")}</h1>
      <div className="px-2 mb-3">
        <CompanySwitcher />
      </div>
      <nav className="flex flex-col gap-1 text-sm text-ink-muted">
        {NAV_ITEMS.map(({ to, labelKey, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-2.5 py-2 rounded-md font-medium ${
                isActive
                  ? "bg-brand-bg text-brand"
                  : "hover:bg-surface-soft hover:text-ink"
              }`
            }
          >
            <Icon className="flex-shrink-0" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto">
        <SidebarFooter />
      </div>
    </aside>
  );
};
```

- [ ] **Step 2: Typecheck + lint**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
```

Expected: green. The new component compiles cleanly; it's not yet wired into App.tsx (Task 4 wires it).

- [ ] **Step 3: Commit**

```powershell
git add apps/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat(m16): add new sidebar component with 5 items"
```

---

## Task 4: Wire new Sidebar in App.tsx + remove inline Sidebar

**Files:**
- Modify: `apps/renderer/src/App.tsx`

Context: substituir a Sidebar inline (linhas ~50-228) por `import { Sidebar } from "./components/layout/Sidebar.js"`. Limpar imports que ficaram só por causa da Sidebar inline:
- `useAgentsStore` — ainda é usado no efeito de bootstrap (`loadAgents`), MAS no contexto da Sidebar removida ele era usado para `agents` (a lista). Verificar se `useAgentsStore((s) => s.agents)` é referenciado em outro lugar do App.tsx. Se não, remover.
- `useInboxStore((s) => s.unread)` — era usado para o badge no NavLink `/inbox`. A Sidebar nova não tem `/inbox`, mas o `loadInbox` continua sendo chamado no efeito de bootstrap. Confirmar.
- `AgentStatus` import + `STATUS_COLOR` — só usado pela lista de agentes da Sidebar removida. Remover.
- `NavLink` — não é mais usado dentro do App.tsx (apenas pela Sidebar que agora vive no próprio arquivo). Remover do import de `react-router-dom`.

Boilerplate: a Sidebar atual está declarada como `const Sidebar = () => { ... }` entre as linhas 50 e 228 (aproximadamente). Substituir por um único `import` no topo + apagar a declaração inteira.

O componente `Layout` (linhas 240-245) continua referenciando `<Sidebar />` — só agora o Sidebar é o importado, não o local.

- [ ] **Step 1: Read App.tsx to confirm current state**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
git diff HEAD -- apps/renderer/src/App.tsx
```

(Should be empty before this task starts.) Read the file to confirm the Sidebar inline declaration starts around line 50.

- [ ] **Step 2: Add the new import**

Open `apps/renderer/src/App.tsx`. After the existing component imports (alphabetic — find the imports of `Briefing`, `Dashboard`, etc., and the `SidebarFooter`/`TitleBar` imports), ADD:

```typescript
import { Sidebar } from "./components/layout/Sidebar.js";
```

- [ ] **Step 3: Delete the inline Sidebar declaration**

Find the inline declaration starting around line 50:

```typescript
const Sidebar = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const inboxUnread = useInboxStore((s) => s.unread);
  return (
    <aside className="w-56 bg-surface border-r border-surface-border flex flex-col p-3">
      ...
```

Delete from `const Sidebar = () => {` through its closing `};` (around line 228). The next code below should be:

```typescript
const Shell = ({ children }: { children: React.ReactNode }) => (
  ...
);
```

- [ ] **Step 4: Remove now-unused imports**

After deleting the inline Sidebar, the following imports from App.tsx are likely unused:

- `NavLink` from `react-router-dom` — verify it isn't used elsewhere in App.tsx by searching the file for `<NavLink`. If no remaining usage, remove `, NavLink` from the `react-router-dom` import line.
- `useTranslation` from `react-i18next` — verify it isn't used elsewhere. If no remaining usage, remove the entire `import { useTranslation } from "react-i18next";` line.
- `AgentStatus` type import — only the Sidebar used `STATUS_COLOR: Record<AgentStatus, string>`. Remove `type AgentStatus` from the `@prospero/shared` import.
- The `STATUS_COLOR` const declaration (lines ~42-49). Remove the entire `const STATUS_COLOR: Record<AgentStatus, string> = {...}` block.

DO NOT remove:
- `useAgentsStore` — still used in `useEffect` for bootstrap (`loadAgents`) AND for the agent-event subscriptions (`applyAgentStatus`, etc.).
- `useInboxStore` — still used for `loadInbox` in bootstrap.

After cleanup, run `pnpm typecheck` to verify nothing dangling.

- [ ] **Step 5: Typecheck + lint + renderer tests + main + shared**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
```

Expected: all green. ESLint may flag unused imports — clean them up.

- [ ] **Step 6: Smoke-check (optional, if Electron available)**

```powershell
pnpm dev
```

If `pnpm dev` works on this machine:
- App starts; the sidebar shows 5 items (Home / Ask for something / Projects / My team / Settings — or pt-BR equivalents).
- No agents listed in the sidebar.
- Clicking "Home" → `/briefing` (Vitrine renders).
- Clicking "Ask for something" → `/goals/new` (GoalNew form renders).
- Clicking "Projects" → `/projects` (Projects list renders).
- Clicking "My team" → `/agents` (Agents list renders).
- Clicking "Settings" → `/settings` (Settings renders).
- CompanySwitcher still works at the top.
- SidebarFooter still at the bottom.

If `pnpm dev` cannot run, skip; tests + typecheck cover the regression net.

- [ ] **Step 7: Pre-commit sanity**

```powershell
git status --short
git diff HEAD --stat
```

Confirm only `apps/renderer/src/App.tsx` changed in this task. The diff should be NET-NEGATIVE (~180 lines deleted from inline Sidebar, ~1 line added for the import). Likely net around -175.

- [ ] **Step 8: Commit**

```powershell
git add apps/renderer/src/App.tsx
git commit -m "feat(m16): wire new sidebar and remove inline declaration"
```

---

## Final verification

- [ ] **Step 1: Run the full suite**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm test
```

Expected:
- typecheck: 4 packages green.
- lint: 4 packages green.
- tests: same total as base (1741 passing + 2 todo) — no new tests in this PR, no removed tests.

- [ ] **Step 2: Inspect commit graph**

```powershell
git log --oneline bb17eaf..HEAD
```

Expected: 4 commits (1 per task), scoped, all `feat(m16):` prefix.

- [ ] **Step 3: Pre-push**

The user pushes when ready:

```powershell
git push origin main
```

- [ ] **Step 4: Memory update**

Create `project_m16_pr_a1_lessons.md` capturing:
- HEAD SHA after merge.
- 4 commits, 0 new tests.
- Decisions: Início→/briefing (M14 reconciliation per spec §17); deep vocabulary deferred to per-screen PRs; agents list removed from sidebar (will be reachable via Minha equipe in PR-C).
- Any surprises during implementation.

Update `MEMORY.md` index with the one-line entry and update `project_session_handoff.md` to mark PR-A1 done + identify next PR (likely PR-B Início+Ajustes).

---

## Notes for the implementer

- **Identidade visual preservada:** Poppins, blue tokens. Don't restyle anything outside the new Sidebar.
- **5 NAV_ITEMS array** is intentional — DRY for rendering 5 NavLinks with the same pattern.
- **No emojis** anywhere — only SVG. If you find yourself typing `▶` or similar, stop and use an SVG path.
- **`end` prop on /agents NavLink** — necessary because `/agents/:id` is a sub-route, and without `end`, the NavLink would stay active when on agent detail pages. Match the existing pattern (line ~107 in current App.tsx).
- **`mt-auto` on SidebarFooter wrapper** — pushes it to the bottom of the sidebar. The original inline Sidebar relied on the flexbox order; the extracted Sidebar makes it explicit.
- **Width `w-56`** matches the current Sidebar exactly. The mockup `shell-navigation-hifi.html` shows 194px; w-56 is 224px. Keeping the current width preserves visual consistency; if the user later wants tighter width, that's a polish item for PR-G.
- **The reduction from 11 to 5 nav items removes:** Dashboard, Inbox, Issues, Goals, Org Chart, Roles, Telos, Costs, Activity, Routines. Those routes still EXIST and work; they're just not reachable from the sidebar. This is by design — they'll be absorbed into the new screens (PR-B/C/D/E):
  - Dashboard/Inbox/Activity → Início (PR-B)
  - Goals/Org Plan → Pedir algo (PR-D)
  - Issues → Projetos kanban (PR-E)
  - Agents/Org Chart/Roles → Minha equipe + Ajustar (PR-C)
  - Costs → Ajustes (PR-B)
  - Telos, Routines → not yet mapped (TBD in later PRs)
- **Routines `/routines`** — currently has its own nav item in the existing Sidebar. After PR-A1, no sidebar entry. Routines remain reachable via `/routines` direct navigation. PR-G consolidation can decide whether to surface Routines via "Ajustes → Avançado" or similar.
- **Existing nav.* i18n keys** (briefing, dashboard, inbox, etc.) remain in JSON. They become dead keys. Cleanup is deferred to PR-G or a dedicated PR-A2.
