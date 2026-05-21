# M16 PR-E — Projetos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox tracking.

**Goal:** Reskinar `/projects` pro layout M16 §7. A infra master/detail (sidebar de projetos + painel ProjectDetail) já existe — PR-E adiciona header amigável + vocab "Projetos" (já vinha da PR-A1 sidebar) + reorganização: título + subtítulo + botão "+ Novo projeto" no header em vez de fundo do sidebar interno.

**Architecture:** Reskin in-place de `Projects.tsx` (152 LOC). Reorganiza o layout: header novo no topo (full-width) com título + subtítulo + botão "+ Novo projeto"; abaixo, master/detail existente (sidebar interno + ProjectDetail). Kanban embebido em ProjectDetail fica pra PR-G (precisa mexer no componente extraído, fora do escopo light).

**Tech Stack:** React 18 · TypeScript strict · react-i18next · Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-18-m16-interface-redesign-design.md` §7. Mockup: `docs/m16-mockups/screen-projetos-b2.html`. Base: HEAD `bca788c` (M16 PR-D close).

---

## File map

**Modificados (renderer, 3):**
- `apps/renderer/src/i18n/en-US.json` — bloco `projetos.*` (3 chaves: title, subtitle, novoProjeto).
- `apps/renderer/src/i18n/pt-BR.json` — mirror.
- `apps/renderer/src/routes/Projects.tsx` — adiciona header top + reposiciona "+ Novo projeto" pro header. Master/detail existente preservado.

---

## Task 1: i18n `projetos.*` keys

- [ ] **Step 1: Add to `en-US.json`** — top-level `"projetos"` block:

```json
  "projetos": {
    "title": "Projects",
    "subtitle": "Each project is a folder. Pick a project to see its tasks and team access.",
    "novoProjeto": "+ New project"
  },
```

- [ ] **Step 2: Mirror in `pt-BR.json`**:

```json
  "projetos": {
    "title": "Projetos",
    "subtitle": "Cada projeto é uma pasta. Escolha um projeto pra ver suas tarefas e acessos.",
    "novoProjeto": "+ Novo projeto"
  },
```

- [ ] **Step 3: Parity + typecheck + commit**:

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/i18n/parity.test.ts
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm --filter @prospero/renderer test
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(m16): add projetos i18n keys"
```

---

## Task 2: Reskin `Projects.tsx` header

**Files:**
- Modify: `apps/renderer/src/routes/Projects.tsx`

Context: adicionar header full-width no topo do componente (título + subtítulo + botão "+ Novo projeto"). O master/detail existente vai abaixo. Movemos o botão "+ Novo projeto" que estava no sidebar interno (linha ~93-102) pro header. O `h2` interno "Projetos" no sidebar (linha 66) pode ficar como label do master OU ser removido (header novo já tem o título).

Pragmatic: deletar o `h2` interno (linha 66) — header novo no topo cobre. Remover o botão "+ Novo projeto" do fundo do sidebar interno + mover pro header. Preservar checkbox "show archived".

- [ ] **Step 1: Edit Projects.tsx — wrap with new header**

Open `apps/renderer/src/routes/Projects.tsx`. Find the return statement at line ~62:

```typescript
  return (
    <div className="flex h-full">
      <div className="w-64 border-r border-surface-border p-3 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-brand-dark">{t("projects.title")}</h2>
        </div>
```

Replace with:

```typescript
  return (
    <div className="flex flex-col h-full">
      <header className="px-8 py-6 border-b border-surface-border bg-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">{t("projetos.title")}</h1>
            <p className="mt-1 text-sm text-ink-soft">{t("projetos.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded hover:opacity-90 whitespace-nowrap"
          >
            {t("projetos.novoProjeto")}
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <div className="w-64 border-r border-surface-border p-3 flex flex-col">
```

(Adiciona um wrapper externo flex-col + header + wrapper interno flex pra master/detail. Removeu o `<div className="flex items-center justify-between mb-3">` e o h2 interno.)

- [ ] **Step 2: Edit Projects.tsx — remove duplicate "+ Novo projeto" button + close wrapper**

Find the existing button at around line 93:

```typescript
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="text-xs px-3 py-2 bg-brand text-brand-fg rounded font-semibold mt-2"
        >
          {t("projects.newButton")}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
```

Replace with (remove the button — kept in header now; keep the rest):

```typescript
      </div>
      <div className="flex-1 overflow-auto">
```

- [ ] **Step 3: Edit Projects.tsx — close the new wrapper div**

Find the end of the return, around line 150-152:

```typescript
        />
      )}
    </div>
  );
};
```

Replace with (close the new flex-1 wrapper):

```typescript
        />
      )}
      </div>
    </div>
  );
};
```

Net: added 1 wrapping `</div>` to close the new `<div className="flex flex-1 min-h-0">`.

- [ ] **Step 4: Typecheck + lint + tests**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
```

Expected: green. Tests unchanged.

- [ ] **Step 5: Commit**

```powershell
git add apps/renderer/src/routes/Projects.tsx
git commit -m "feat(m16): reskin projects with m16 header"
```

---

## Task 3: Final verification + push

```powershell
pnpm typecheck && pnpm lint && pnpm test
git push origin main
```

Expected: green. Memory updated together with PR-F when both ship.

---

## Notes

- **Kanban embebido em ProjectDetail** fica pra PR-G — escopo light agora.
- **`projects.*` keys ficam** — ProjectDetail e outros consumidores continuam usando. Apenas o header top-level usa `projetos.*`.
- **Vocab interno** (ProjectDetail, ProjectListItem, ProjectFormModal) preservado.
- **Sem testes novos** — convenção renderer.
