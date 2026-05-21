# M16 PR-C2 — Página do funcionário Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskinar `/agents/:id` per spec §9: a página É a conversa em tela cheia, com header simples + botão "Ajustar". Remove o mode TabBar (Conversa/Estúdio); o Estúdio migra para nova sub-rota `/agents/:id/ajustar` como placeholder (PR-C3 vai substituí-lo pelo novo layout de 5 abas).

**Architecture:** Novo componente `BreadcrumbBar.tsx` (componente fino: back link "← Minha equipe" + Ajustar button OU "Conversa" link, conforme o `mode` prop). `Agent.tsx` perde a mode-state TabBar — sempre renderiza `BreadcrumbBar` (modo conversa) + `AgentHeader` (existing, intacto) + `AgentConversation`. Nova rota `/agents/:id/ajustar` renderiza um wrapper `AgentAjustar.tsx` que monta `BreadcrumbBar` (modo ajustar) + `AgentHeader` + `AgentStudio` (com as 6 abas existentes — placeholder; PR-C3 substitui).

**Tech Stack:** React 18 · React Router v6 (HashRouter) · TypeScript strict · react-i18next · Tailwind · zustand (`useAgentsStore` existing) · existing AgentHeader/AgentConversation/AgentStudio components.

**Spec:** `docs/superpowers/specs/2026-05-18-m16-interface-redesign-design.md` §9. Mockup: `docs/m16-mockups/page-funcionario.html`. Base: HEAD `99a7add` (M16 PR-C1 close).

---

## File map

**Criados (renderer, 2):**
- `apps/renderer/src/components/agent-panel/BreadcrumbBar.tsx` — back link + Ajustar/Conversa button (depending on mode prop).
- `apps/renderer/src/routes/AgentAjustar.tsx` — nova rota `/agents/:id/ajustar` renderiza BreadcrumbBar + AgentHeader + AgentStudio (placeholder pra PR-C3).

**Modificados (renderer, 3):**
- `apps/renderer/src/routes/Agent.tsx` — remove mode TabBar + state + AgentStudio render. Renderiza BreadcrumbBar + AgentHeader + AgentConversation. Skills/Memories fetch preservado (alimenta `AgentHeader` learning badge).
- `apps/renderer/src/App.tsx` — adiciona Route pra `/agents/:id/ajustar`.
- `apps/renderer/src/i18n/en-US.json` + `pt-BR.json` — adiciona `funcionario.*` block (3 chaves).

**Total:** 2 criados + 4 modificados = 6 arquivos.

---

## Conventions

- Sempre `pnpm typecheck` antes de commitar.
- Pre-commit hook: prettier + eslint + gitleaks. Nunca `--no-verify`.
- Commits lowercase, ≤72 chars, sem `+`/`%`.
- Sem emojis — SVG inline pro chevron `←` (Unicode `←` é typographic, não emoji — OK).
- Identidade visual: Poppins, blue tokens.
- Renderer-only — zero mudança em main/shared.

### Comandos

Pasta raiz: `D:\Projetos pessoais\DashboardAgent`. PowerShell.

- Tests renderer um arquivo: `cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"; npx vitest run <relative-path>`
- Tests full renderer: `pnpm --filter @prospero/renderer test`
- Typecheck workspace: `pnpm typecheck`
- Lint: `pnpm lint`

---

## Task 1: i18n keys — `funcionario.*` block

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

Context: 3 chaves novas (`funcionario.ajustar` button label, `funcionario.voltarConversa` back link from Ajustar, `funcionario.title` page label). Reusa `nav.equipe` (já adicionado em PR-A1) pro back link "← Minha equipe".

- [ ] **Step 1: Add to `en-US.json`**

Open `apps/renderer/src/i18n/en-US.json`. Add a new top-level `"funcionario"` block (alphabetical — após `equipe`):

```json
  "funcionario": {
    "ajustar": "Adjust",
    "voltarConversa": "Conversation",
    "title": "Team member"
  },
```

- [ ] **Step 2: Mirror in `pt-BR.json`**

```json
  "funcionario": {
    "ajustar": "Ajustar",
    "voltarConversa": "Conversa",
    "title": "Funcionário"
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
git commit -m "feat(m16): add funcionario i18n keys"
```

---

## Task 2: `BreadcrumbBar` component

**Files:**
- Create: `apps/renderer/src/components/agent-panel/BreadcrumbBar.tsx`

Context: barra fina acima do AgentHeader. Props: `agentId`, `agentName`, `mode` (`"conversa" | "ajustar"`). Em `conversa`: mostra `← Minha equipe` + `[Ajustar]` button (rota pra `/agents/:agentId/ajustar`). Em `ajustar`: mostra `← Minha equipe / {agentName} / Ajustar` breadcrumb (último é texto, não link); um botão sutil "Conversa" volta pra `/agents/:agentId`.

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/components/agent-panel/BreadcrumbBar.tsx` with EXACTLY:

```typescript
import type { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

// M16 PR-C2 — barra fina acima do AgentHeader na Página do funcionário.
// Mostra back link + ação ("Ajustar" no modo conversa; "Conversa" no modo ajustar).

type Mode = "conversa" | "ajustar";

type Props = {
  agentId: string;
  agentName: string;
  mode: Mode;
};

export const BreadcrumbBar: FC<Props> = ({ agentId, agentName, mode }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surface-soft border-b border-surface-border text-xs">
      <div className="flex items-center gap-2 text-ink-muted">
        <Link to="/agents" className="hover:text-ink">
          ← {t("nav.equipe")}
        </Link>
        <span>/</span>
        {mode === "conversa" ? (
          <span className="text-ink font-semibold">{agentName}</span>
        ) : (
          <>
            <Link to={`/agents/${agentId}`} className="hover:text-ink">
              {agentName}
            </Link>
            <span>/</span>
            <span className="text-ink font-semibold">{t("funcionario.ajustar")}</span>
          </>
        )}
      </div>
      {mode === "conversa" ? (
        <Link
          to={`/agents/${agentId}/ajustar`}
          className="text-xs font-semibold px-3 py-1 rounded bg-surface-card border border-surface-border text-ink hover:border-brand hover:text-brand"
        >
          {t("funcionario.ajustar")}
        </Link>
      ) : (
        <Link
          to={`/agents/${agentId}`}
          className="text-xs font-semibold px-3 py-1 rounded bg-surface-card border border-surface-border text-ink hover:border-brand hover:text-brand"
        >
          ← {t("funcionario.voltarConversa")}
        </Link>
      )}
    </div>
  );
};
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
git add apps/renderer/src/components/agent-panel/BreadcrumbBar.tsx
git commit -m "feat(m16): add breadcrumb bar for funcionario pages"
```

---

## Task 3: Modify `Agent.tsx` — remove mode TabBar, always render conversation

**Files:**
- Modify: `apps/renderer/src/routes/Agent.tsx`

Context: remove o mode-state + TabBar + AgentStudio conditional render. Sempre renderiza BreadcrumbBar (modo conversa) + AgentHeader + AgentConversation. Skills/memories fetch preservado (alimenta o badge de learning no AgentHeader). O callback `onOpenLearning` no AgentHeader vai ficar dead em `/agents/:id` (mode "estudio" não existe mais nesta rota); PR-C3 lida com isso ao reskinear AgentHeader. Por enquanto, passar callback no-op.

Imports a remover:
- `useState` (mode + studioTab state vão)
- `AgentStudio`, `StudioTab` (não usados aqui mais)
- `TabBar` (não usado aqui mais)

Imports a adicionar:
- `BreadcrumbBar` from `../components/agent-panel/BreadcrumbBar.js`

- [ ] **Step 1: Replace entire contents of `Agent.tsx`**

Open `apps/renderer/src/routes/Agent.tsx`. Replace ALL contents with EXACTLY:

```typescript
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { AgentHeader } from "../components/agent-panel/AgentHeader.js";
import { AgentConversation } from "../components/agent-panel/AgentConversation.js";
import { BreadcrumbBar } from "../components/agent-panel/BreadcrumbBar.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";

// M16 PR-C2 — Página do funcionário (modo conversa).
// /agents/:id agora é só a conversa + header com link "Ajustar" → /agents/:id/ajustar.
// O Estúdio (6 abas) saiu desta rota — vive em /agents/:id/ajustar (AgentAjustar.tsx).
// Mode TabBar removido; M16 spec §9 diz "a página É a conversa".

export const Agent = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [showAssignTask, setShowAssignTask] = useState(false);

  // M11 skills/memory feed the AgentHeader 🎓 badge.
  useEffect(() => {
    if (agent === undefined) return;
    void (async () => {
      const [s, m] = await Promise.all([
        window.prospero.learning.listSkills(agent.id),
        window.prospero.learning.listMemories(agent.id),
      ]);
      setSkills(s);
      setMemories(m);
    })();
  }, [agent]);

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex flex-col h-screen min-w-0">
      <BreadcrumbBar agentId={agent.id} agentName={agent.name} mode="conversa" />
      <AgentHeader
        agent={agent}
        onAssignTask={() => setShowAssignTask(true)}
        skillCount={skills.length}
        memoryCount={memories.length}
        onOpenLearning={() => {
          // M16 PR-C2: Learning tab moved into /agents/:id/ajustar (PR-C3 reskin).
          // No-op here — Learning content is reachable via the Ajustar button.
        }}
      />
      <AgentConversation agent={agent} />
      {showAssignTask && (
        <IssueFormModal
          companyId={agent.companyId}
          initialAssigneeId={agent.id}
          onClose={() => setShowAssignTask(false)}
        />
      )}
    </div>
  );
};
```

Changes vs old Agent.tsx:
- Removed: `import { AgentStudio, type StudioTab }`, `import { TabBar }`, `Mode` type, `mode`/`studioTab` states, mode TabBar JSX, conditional render of AgentConversation/AgentStudio.
- Added: `import { BreadcrumbBar }`, render BreadcrumbBar at top.
- `useEffect` deps simplified — only `[agent]` now (was `[agent, mode, studioTab]`).
- `onOpenLearning` is no-op (badge still visible, click does nothing for now; PR-C3 makes it work).

- [ ] **Step 2: Typecheck + lint + renderer suite**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
```

Expected: all green. Renderer 204 unchanged.

- [ ] **Step 3: Commit**

```powershell
git add apps/renderer/src/routes/Agent.tsx
git commit -m "feat(m16): agent route shows conversation only"
```

---

## Task 4: `AgentAjustar.tsx` route — placeholder rendering Studio

**Files:**
- Create: `apps/renderer/src/routes/AgentAjustar.tsx`

Context: nova rota `/agents/:id/ajustar`. Renderiza BreadcrumbBar (mode=ajustar) + AgentHeader + AgentStudio (placeholder; PR-C3 vai substituir AgentStudio pelo layout de 5 abas).

Replica a lógica de Agent.tsx (skills/memories fetch, agent lookup, assign task modal) mas mostra AgentStudio com `mode: "estudio"` em vez de Conversation. O `studioTab` state ainda controla qual das 6 abas existentes (config/instructions/issues/stats/learning/runs) está visível.

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/routes/AgentAjustar.tsx` with EXACTLY:

```typescript
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { AgentHeader } from "../components/agent-panel/AgentHeader.js";
import { AgentStudio, type StudioTab } from "../components/agent-panel/AgentStudio.js";
import { BreadcrumbBar } from "../components/agent-panel/BreadcrumbBar.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";

// M16 PR-C2 — /agents/:id/ajustar — placeholder. Renderiza AgentStudio
// (6 abas existentes). PR-C3 vai substituir AgentStudio pelo layout
// novo de 5 abas (Identidade · Instruções · Habilidades · Comportamento · Histórico).

export const AgentAjustar = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [studioTab, setStudioTab] = useState<StudioTab>("config");
  const [showAssignTask, setShowAssignTask] = useState(false);

  useEffect(() => {
    if (agent === undefined) return;
    void (async () => {
      const [s, m] = await Promise.all([
        window.prospero.learning.listSkills(agent.id),
        window.prospero.learning.listMemories(agent.id),
      ]);
      setSkills(s);
      setMemories(m);
    })();
  }, [agent, studioTab]);

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex flex-col h-screen min-w-0">
      <BreadcrumbBar agentId={agent.id} agentName={agent.name} mode="ajustar" />
      <AgentHeader
        agent={agent}
        onAssignTask={() => setShowAssignTask(true)}
        skillCount={skills.length}
        memoryCount={memories.length}
        onOpenLearning={() => setStudioTab("learning")}
      />
      <AgentStudio
        agent={agent}
        tab={studioTab}
        onTab={setStudioTab}
        skills={skills}
        memories={memories}
      />
      {showAssignTask && (
        <IssueFormModal
          companyId={agent.companyId}
          initialAssigneeId={agent.id}
          onClose={() => setShowAssignTask(false)}
        />
      )}
    </div>
  );
};
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
git add apps/renderer/src/routes/AgentAjustar.tsx
git commit -m "feat(m16): add agent ajustar route placeholder"
```

---

## Task 5: Wire `/agents/:id/ajustar` in App.tsx

**Files:**
- Modify: `apps/renderer/src/App.tsx`

Context: adicionar Route pra `/agents/:id/ajustar` que renderiza `AgentAjustar`. A rota `/agents/:id` continua renderizando `Agent` (modo conversa, agora simples).

- [ ] **Step 1: Add the import**

Open `apps/renderer/src/App.tsx`. Find the existing import of `Agent`:

```typescript
import { Agent as AgentRoute } from "./routes/Agent.js";
```

Right after it (or in alphabetical position with other route imports), add:

```typescript
import { AgentAjustar } from "./routes/AgentAjustar.js";
```

- [ ] **Step 2: Add the Route**

Find the existing `<Route path="/agents/:id" ...>` block in App's Routes section. Right AFTER it (so the more-specific `/agents/:id/ajustar` matches before `/agents/:id` would; React Router v6 actually matches exact paths so order is less critical, but adjacency helps readability), insert:

```typescript
          <Route
            path="/agents/:id/ajustar"
            element={
              hasToken ? (
                <Layout>
                  <AgentAjustar />
                </Layout>
              ) : (
                <Navigate to="/setup" replace />
              )
            }
          />
```

Match the surrounding indentation. The `hasToken` guard mirrors the existing `/agents/:id` route.

- [ ] **Step 3: Typecheck + lint + full suite**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
pnpm --filter @prospero/main test
pnpm --filter @prospero/shared test
```

Expected: all green. Same total test count as base (1747).

- [ ] **Step 4: Pre-commit sanity**

```powershell
git status --short
git diff HEAD --stat
```

Confirm only `apps/renderer/src/App.tsx` changed in this task.

- [ ] **Step 5: Commit**

```powershell
git add apps/renderer/src/App.tsx
git commit -m "feat(m16): wire agent ajustar route"
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
- tests: same total as base (1747 passing + 2 todo).

- [ ] **Step 2: Inspect commit graph**

```powershell
git log --oneline 99a7add..HEAD
```

Expected: 5 commits (1 per task), all `feat(m16):` prefix.

- [ ] **Step 3: Smoke check (optional)**

If `pnpm dev` works:
- Sidebar "Minha equipe" → click an agent → `/agents/:id` shows: BreadcrumbBar + AgentHeader + Conversation (no Estúdio toggle).
- Click "Ajustar" button → `/agents/:id/ajustar` shows: BreadcrumbBar (mode=ajustar) + AgentHeader + AgentStudio (6 abas).
- Click "← Conversa" → back to `/agents/:id`.
- Click "← Minha equipe" → back to organograma.
- All AgentStudio features (Config, Instructions, Issues, Stats, Learning, Runs) work as before.

- [ ] **Step 4: Push + memory**

```powershell
git push origin main
```

Memory updates after PR-C3 closes the M16 PR-C (next plan).

---

## Notes for the implementer

- **AgentStudio fica intacto** — só MOVE de `/agents/:id` pra `/agents/:id/ajustar`. PR-C3 vai substituir o conteúdo de AgentStudio pelo layout de 5 abas.
- **AgentHeader fica intacto** — PR-C3 ou PR-G consolidação pode simplificá-lo.
- **`onOpenLearning` no `/agents/:id` (conversa)** vira no-op — o botão de learning badge no AgentHeader não tem mais pra onde abrir nessa rota (Estúdio saiu). PR-C3 pode redirecionar pra Ajustar → Histórico ou remover o badge dali. Por enquanto, no-op não quebra (botão é visual; click não falha).
- **`useEffect` deps em `Agent.tsx` simplificado** — antes era `[agent, mode, studioTab]`; agora só `[agent]` (sem mode/studioTab state). Refetch é mais raro mas funcional.
- **No emojis** — typographic Unicode `←` é OK (não é emoji).
- **Sem testes em componentes/rotas** — convenção renderer.
- **Sub-rota `/agents/:id/ajustar`** já existe em zero outros lugares; não preciso conferir conflitos. Mas o `:id` route deve vir antes ou depois? React Router v6 prefere ordering por especificidade — mais específico primeiro. Coloquei `/agents/:id/ajustar` ADJ ao `/agents/:id` na ordem dos `<Route>` no `<Routes>`.
- **`exactOptionalPropertyTypes`** pode reclamar em algum lugar. Se reclamar, usar conditional spread.
