# M16 PR-C1 — Minha equipe (organograma como `/agents`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a tela `/agents` (atual: grid de cards) pelo organograma visual (CEO no topo + hierarquia conectada por linhas) — usando a infra já existente em `Org.tsx`. Click num nó navega pra `/agents/:id` (substitui drawer lateral). Botão "+ Contratar alguém" no header. Deleta o route legado `/org` e o arquivo `Org.tsx`.

**Architecture:** Move o organograma de `Org.tsx` (251 LOC, route `/org`) pra `Agents.tsx` (route `/agents`). Mantém `layoutTree`, `OrgNode`, `ReassignConfirmModal` e drag-to-reparent (M9 power feature). Remove side drawer + estados associados (selectedId, selectedOpenIssues, useIssuesStore import) — click agora navega via `useNavigate`. Header novo com título + subtítulo + CTA "Contratar" (reusa `RoleTemplateGalleryModal`). Rota `/org` apagada do App.tsx; `Org.tsx` deletado.

**Tech Stack:** React 18 · TypeScript strict · react-i18next · Tailwind · zustand (`useAgentsStore`, `useIssuesStore` deletado deste arquivo) · React Router v6 (`useNavigate`) · SVG inline (existing `layoutTree`/`OrgNode`).

**Spec:** `docs/superpowers/specs/2026-05-18-m16-interface-redesign-design.md` §8. Mockup: `docs/m16-mockups/page-equipe.html`. Base: HEAD `f19c524` (M16 PR-B2 close).

---

## File map

**Modificados (renderer, 3):**
- `apps/renderer/src/i18n/en-US.json` — adiciona bloco `equipe.*` (5 chaves).
- `apps/renderer/src/i18n/pt-BR.json` — mirror.
- `apps/renderer/src/routes/Agents.tsx` — reescrita completa. De grid de cards (79 LOC) pra organograma com header + drag-reparent + hire modal + reassign confirm modal + error toast. Click navega.
- `apps/renderer/src/App.tsx` — remove `Org` import + `<Route path="/org">` block.

**Deletados (renderer, 1):**
- `apps/renderer/src/routes/Org.tsx` — 251 LOC, conteúdo absorvido pelo novo Agents.tsx.

**Total:** 3 modificados + 1 deletado = 4 arquivos. ~3 tasks.

**Não modificados (preservados):**
- `apps/renderer/src/components/org/layoutTree.ts` — reusado.
- `apps/renderer/src/components/org/OrgNode.tsx` — reusado.
- `apps/renderer/src/components/org/ReassignConfirmModal.tsx` — reusado.
- `org.*` i18n keys em JSON — algumas viram dead (drawer keys: `org.drawer.model`, `org.drawer.status`, `org.drawer.openIssues`, `org.drawer.openAgent`). Cleanup defer pra PR-G.

---

## Conventions

- Sempre `pnpm typecheck` antes de commitar.
- Pre-commit hook: prettier + eslint + gitleaks. Nunca `--no-verify`.
- Commits lowercase, ≤72 chars, sem `+`/`%`.
- **Sem emojis** — SVG inline ([[feedback-no-emojis]]).
- Identidade visual: Poppins, blue tokens.
- Renderer-only — zero mudança em main/shared.
- `useNavigate` (react-router-dom) pra navegação programática (substitui drawer click).

### Comandos

Pasta raiz: `D:\Projetos pessoais\DashboardAgent`. PowerShell.

- Tests renderer um arquivo: `cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"; npx vitest run <relative-path>`
- Tests full renderer: `pnpm --filter @prospero/renderer test`
- Typecheck workspace: `pnpm typecheck`
- Lint: `pnpm lint`

---

## Task 1: i18n keys — `equipe.*` block

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

Context: 5 chaves novas no namespace `equipe.*`. As chaves `org.*` ficam no JSON (algumas serão dead, mas cleanup defer pra PR-G consolidação — pattern do PR-A1 e PR-B2).

- [ ] **Step 1: Add to `en-US.json`**

Open `apps/renderer/src/i18n/en-US.json`. Add a new top-level `"equipe"` block (alphabetical order — entre `briefing` e existing blocks):

```json
  "equipe": {
    "title": "My team",
    "subtitle": "Your company's employees, organized by hierarchy.",
    "contratar": "+ Hire someone",
    "empty": {
      "title": "Your team is empty",
      "description": "Hire someone to get started."
    }
  },
```

- [ ] **Step 2: Mirror in `pt-BR.json`**

```json
  "equipe": {
    "title": "Minha equipe",
    "subtitle": "Os funcionários da sua empresa, organizados por hierarquia.",
    "contratar": "+ Contratar alguém",
    "empty": {
      "title": "Sua equipe está vazia",
      "description": "Contrate alguém pra começar."
    }
  },
```

- [ ] **Step 3: Parity test + typecheck**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/i18n/parity.test.ts
```

Expected: pass.

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm --filter @prospero/renderer test
```

Expected: all green.

- [ ] **Step 4: Commit**

```powershell
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(m16): add equipe i18n keys"
```

---

## Task 2: Rewrite `Agents.tsx` with organograma

**Files:**
- Modify: `apps/renderer/src/routes/Agents.tsx`

Context: substituir o grid de cards (79 LOC) pelo organograma completo. Migra a maior parte do `Org.tsx` (drag-reparent, SVG, edges, layoutTree, OrgNode, ReassignConfirmModal, error toast) MENOS o side drawer. Click num nó usa `useNavigate("/agents/:id")` (substitui `setSelectedId`). Header novo com título "Minha equipe" + subtítulo + botão "+ Contratar alguém" que abre `RoleTemplateGalleryModal` (preservado do Agents.tsx atual).

Remove states/imports que viraram dead:
- `selectedId` state + `selected` memo + `selectedOpenIssues` memo (drawer removido)
- `useIssuesStore` import (só usado pelo selectedOpenIssues)
- ESC handler pro drawer (mas mantém o ESC handler do error toast)
- TrustTierBadge import (vivia no card; o organograma não mostra; PR-C2 pode trazer pra página do funcionário)
- `AgentStatus` type + `STATUS_COLOR` const (status fica visível no `OrgNode`, não no header)

- [ ] **Step 1: Read the file first to confirm starting state**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
Get-Content apps/renderer/src/routes/Agents.tsx | Select-Object -First 5
```

Should match the current grid implementation (79 LOC).

- [ ] **Step 2: Replace entire contents of `Agents.tsx`**

Open `apps/renderer/src/routes/Agents.tsx`. Replace ALL contents with EXACTLY:

```typescript
import {
  useEffect,
  useMemo,
  useState,
  type FC,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { RoleTemplateGalleryModal } from "../components/RoleTemplateGalleryModal.js";
import { layoutTree, NODE_DIMENSIONS } from "../components/org/layoutTree.js";
import { OrgNode } from "../components/org/OrgNode.js";
import { ReassignConfirmModal } from "../components/org/ReassignConfirmModal.js";

// M16 PR-C1 — "Minha equipe" — substitui o grid de agentes pelo organograma.
// Migra o conteúdo de Org.tsx menos o side drawer (clicar num nó navega pra
// /agents/:id). Mantém drag-to-reparent (M9 power feature) + ReassignConfirmModal.

export const Agents: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const setReportsTo = useAgentsStore((s) => s.setReportsTo);
  const [showGallery, setShowGallery] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [pendingReassign, setPendingReassign] = useState<{
    childId: string;
    parentId: string;
  } | null>(null);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const layout = useMemo(() => layoutTree(agents), [agents]);

  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of layout.nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [layout]);

  const edges = useMemo(() => {
    return layout.nodes
      .filter((n) => n.reportsTo !== null && positions.has(n.reportsTo))
      .map((n) => ({
        from: positions.get(n.reportsTo!)!,
        to: { x: n.x, y: n.y },
        childId: n.id,
      }));
  }, [layout, positions]);

  // Auto-dismiss the cycle error toast after 4s.
  useEffect(() => {
    if (reassignError === null) return;
    const h = setTimeout(() => setReassignError(null), 4000);
    return () => clearTimeout(h);
  }, [reassignError]);

  const live = agents.filter((a) => a.status !== "terminated");
  const isEmpty = live.length === 0;

  const onNodePointerDown = (id: string, e: ReactPointerEvent<SVGGElement>): void => {
    setDraggingId(id);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (draggingId === null) return;
    const svgEl = e.currentTarget;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgEl.getScreenCTM();
    if (ctm === null) return;
    const local = pt.matrixTransform(ctm.inverse());
    // Outer <g> is translated by (24, 24); adjust for hit-test in local coords.
    const lx = local.x - 24;
    const ly = local.y - 24;
    let foundId: string | null = null;
    for (const n of layout.nodes) {
      if (n.id === draggingId) continue;
      if (
        lx >= n.x &&
        lx <= n.x + NODE_DIMENSIONS.width &&
        ly >= n.y &&
        ly <= n.y + NODE_DIMENSIONS.height
      ) {
        foundId = n.id;
        break;
      }
    }
    setHoverTargetId(foundId);
  };

  const onSvgPointerUp = (): void => {
    if (draggingId !== null && hoverTargetId !== null) {
      setPendingReassign({ childId: draggingId, parentId: hoverTargetId });
    }
    setDraggingId(null);
    setHoverTargetId(null);
  };

  const childName =
    pendingReassign !== null
      ? (agents.find((a) => a.id === pendingReassign.childId)?.name ?? "?")
      : "";
  const parentName =
    pendingReassign !== null
      ? (agents.find((a) => a.id === pendingReassign.parentId)?.name ?? "?")
      : "";

  const svgWidth = layout.width + 48;
  const svgHeight = layout.height + 48;

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-6 border-b border-surface-border bg-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">{t("equipe.title")}</h1>
            <p className="mt-1 text-sm text-ink-soft">{t("equipe.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowGallery(true)}
            className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded hover:opacity-90 whitespace-nowrap"
          >
            {t("equipe.contratar")}
          </button>
        </div>
      </header>

      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-surface-soft p-8">
          <p className="text-base font-semibold text-ink">{t("equipe.empty.title")}</p>
          <p className="text-sm text-ink-muted">{t("equipe.empty.description")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-surface-soft p-6">
          <svg
            width={svgWidth}
            height={svgHeight}
            className="bg-surface-card rounded shadow-sm select-none"
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
          >
            <defs>
              <linearGradient id="avatar-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#5a8fff" />
                <stop offset="100%" stopColor="#3850b0" />
              </linearGradient>
            </defs>
            <g transform="translate(24, 24)">
              {edges.map((e, i) => {
                const startX = e.from.x + NODE_DIMENSIONS.width / 2;
                const startY = e.from.y + NODE_DIMENSIONS.height;
                const endX = e.to.x + NODE_DIMENSIONS.width / 2;
                const endY = e.to.y;
                const midY = (startY + endY) / 2;
                return (
                  <path
                    key={`edge-${e.childId}-${String(i)}`}
                    d={`M${String(startX)},${String(startY)} L${String(startX)},${String(midY)} L${String(endX)},${String(midY)} L${String(endX)},${String(endY)}`}
                    fill="none"
                    stroke="#d0d4dc"
                    strokeWidth={1.5}
                  />
                );
              })}
              {layout.nodes.map((n) => (
                <OrgNode
                  key={n.id}
                  node={n}
                  selected={false}
                  dragging={n.id === draggingId}
                  dropTarget={n.id === hoverTargetId}
                  onPointerDown={(e) => onNodePointerDown(n.id, e)}
                  onClick={() => {
                    if (draggingId === null) navigate(`/agents/${n.id}`);
                  }}
                />
              ))}
            </g>
          </svg>
        </div>
      )}

      {pendingReassign !== null && (
        <ReassignConfirmModal
          childName={childName}
          newParentName={parentName}
          onCancel={() => setPendingReassign(null)}
          onConfirm={async () => {
            try {
              await setReportsTo(pendingReassign.childId, pendingReassign.parentId);
            } catch {
              setReassignError(t("org.reassign.cycleError"));
            }
            setPendingReassign(null);
          }}
        />
      )}

      {reassignError !== null && (
        <div className="fixed bottom-6 right-6 bg-semantic-danger text-white px-4 py-2 rounded shadow-lg text-xs z-50">
          {reassignError}
        </div>
      )}

      {showGallery && <RoleTemplateGalleryModal onClose={() => setShowGallery(false)} />}
    </div>
  );
};
```

Key differences vs the old Agents.tsx grid:
- Imports change: removed `Link`, `TrustTierBadge`, `AgentStatus` (type), `STATUS_COLOR`; added `useEffect`/`useMemo`/`PointerEvent`, `useNavigate`, `layoutTree`/`NODE_DIMENSIONS`, `OrgNode`, `ReassignConfirmModal`.
- New states: `draggingId`, `hoverTargetId`, `pendingReassign`, `reassignError` (from Org.tsx).
- Removed states: `selectedId` (the old Org's drawer state); the new component just navigates.
- Empty state is encouraging ("Sua equipe está vazia. Contrate alguém pra começar.") instead of just "no agents".
- Header always visible, even with empty state.

Key differences vs old Org.tsx:
- No `useIssuesStore` import — issues count was only used by the drawer (now gone).
- No `selectedId`/`selected`/`selectedOpenIssues` state — drawer removed.
- No `ESC` listener for drawer — only kept ESC behavior in error toast (auto-dismiss).
- `OrgNode` receives `selected={false}` always (no selection state in M16).
- Click handler `onClick={() => navigate(...)}` instead of `onClick={() => setSelectedId(...)}`.
- New header with title + subtitle + Contratar button.

- [ ] **Step 3: Typecheck + lint**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
```

Expected: green. Settings.tsx (M16 PR-B2) deleted; Org.tsx (this PR) NOT yet deleted (Task 3 does it).

- [ ] **Step 4: Renderer test suite**

```powershell
pnpm --filter @prospero/renderer test
```

Expected: 204 passing (unchanged baseline; PR-C1 doesn't add tests — renderer convention).

- [ ] **Step 5: Commit**

```powershell
git add apps/renderer/src/routes/Agents.tsx
git commit -m "feat(m16): replace agents grid with org chart minha equipe"
```

---

## Task 3: Delete `/org` route + `Org.tsx` file

**Files:**
- Modify: `apps/renderer/src/App.tsx`
- Delete: `apps/renderer/src/routes/Org.tsx`

Context: `/org` rota e `Org.tsx` ficam órfãos depois do Task 2. A sidebar do PR-A1 não tem link pra `/org` (removido), mas a Route ainda existe. Limpa: remove Route + import; deleta o arquivo.

Verifica que nada mais importa `Org.tsx`:

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
git grep -n "routes/Org" -- "*.ts" "*.tsx"
```

Expected: only `apps/renderer/src/App.tsx` referencing it.

- [ ] **Step 1: Remove the `Org` import from App.tsx**

Open `apps/renderer/src/App.tsx`. Find:

```typescript
import { Org } from "./routes/Org.js";
```

Remove the entire line.

- [ ] **Step 2: Remove the `<Route path="/org">` block**

Find the `<Route path="/org" ...>` block in the App's `<Routes>` section. The current shape:

```typescript
          <Route
            path="/org"
            element={
              hasToken ? (
                <Layout>
                  <Org />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
```

Delete the entire block (~10 lines).

- [ ] **Step 3: Delete `Org.tsx`**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
git rm apps/renderer/src/routes/Org.tsx
```

- [ ] **Step 4: Typecheck + lint + full suite**

```powershell
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
pnpm --filter @prospero/main test
pnpm --filter @prospero/shared test
```

Expected: all green. Same total test count as base (1747 passing + 2 todo).

- [ ] **Step 5: Pre-commit sanity**

```powershell
git status --short
git diff HEAD --stat
```

Confirm: `apps/renderer/src/App.tsx` modified, `apps/renderer/src/routes/Org.tsx` deleted. No other files.

- [ ] **Step 6: Commit**

```powershell
git add apps/renderer/src/App.tsx apps/renderer/src/routes/Org.tsx
git commit -m "feat(m16): remove old /org route and file"
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
- tests: same total as base (1747 passing + 2 todo) — no new tests.

- [ ] **Step 2: Inspect commit graph**

```powershell
git log --oneline f19c524..HEAD
```

Expected: 3 commits (1 per task), all `feat(m16):` prefix.

- [ ] **Step 3: Smoke check (optional, if Electron available)**

If `pnpm dev` runs:
- Sidebar "Minha equipe" → `/agents` → see organograma com CEO no topo, agentes conectados por linhas.
- Header com título "Minha equipe" + subtítulo + botão "+ Contratar alguém".
- Click "+ Contratar alguém" → abre `RoleTemplateGalleryModal`.
- Click num nó qualquer → navega pra `/agents/:id` (Agent Studio atual — vai ser reskinado em PR-C2).
- Drag um nó pra outro → ReassignConfirmModal abre.
- Error toast aparece se reparenting cria ciclo.
- `/org` retorna 404 (route removida).

If `pnpm dev` cannot run, skip; tests + typecheck cover.

- [ ] **Step 4: Push + memory + handoff**

```powershell
git push origin main
```

Create `project_m16_pr_c1_lessons.md`:
- HEAD SHA after merge.
- 3 commits, 0 new tests, ~-100 LOC líquido (Org.tsx 251 deletado + Agents.tsx old 79 substituído por novo ~180 LOC).
- Decisões: organograma já existia em Org.tsx; PR-C1 = consolidação de duas rotas (/agents grid + /org organograma) numa só (/agents organograma).
- Surprises encountered.

Update `MEMORY.md` index + `project_session_handoff.md` to mark PR-C1 done + identify next PR (PR-C2 — Página do funcionário).

---

## Notes for the implementer

- **`Org.tsx` é a fonte do código** — o organograma já existe e funciona. PR-C1 = move + simplifica. Não inventar nova lógica de layout/SVG.
- **`layoutTree`, `OrgNode`, `ReassignConfirmModal` ficam onde estão** em `components/org/`. Reusados pelo novo `Agents.tsx`.
- **Drag-to-reparent é preservado** — M9 power feature, spec §16 "Nada é deletado".
- **Side drawer removido** — click navega via `useNavigate("/agents/:id")`. Per spec §8 "Tocar em qualquer nó — CEO ou funcionário — abre a Página do funcionário daquela pessoa".
- **Empty state encoraja contratação** — não só "no agents", mas "Sua equipe está vazia. Contrate alguém pra começar." Header com botão "Contratar" continua visível pra discoverability.
- **`org.*` i18n keys ficam no JSON** — algumas viram dead após este PR (drawer keys). PR-G consolidation limpa.
- **`useIssuesStore` removido do Agents.tsx** — era usado apenas pelo `selectedOpenIssues` do drawer.
- **`TrustTierBadge` removido do Agents.tsx** — vivia nos cards do grid. PR-C2 pode trazer pra Página do funcionário se for útil.
- **Sub-rotas `/agents/:id`** existem (Agent Studio atual). PR-C2 reskina. PR-C1 só muda a entrada `/agents`.
- **`useNavigate` precisa estar dentro de `<HashRouter>`** — já está (App é wrapped).
