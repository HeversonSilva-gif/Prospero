# M16 PR-D — Pedir algo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reskinar `/goals/new` pro layout M16 §6 "Pedir algo": header amigável + layout 2 colunas (formulário esquerda + painel "o que o CEO vai fazer" à direita). Preserva toda a funcionalidade do form atual (236 LOC). Vocabulário aligned: "Pedir algo" em vez de "novo objetivo".

**Architecture:** Reskin in-place do `GoalNew.tsx`. Substitui o título "Novo objetivo" por header "Pedir algo" + sub-linha narrativa. Envolve o form existente em layout 2-col flex; coluna direita é um painel estático que explica o que vai acontecer ("Você descreve · O CEO transforma em um plano · A equipe executa"). Form fields ficam intocados (vocabulary update via i18n `pedir.*` se desejado posterior; PR-D v1 mantém keys `goals.new.*` existentes).

**Tech Stack:** React 18 · TypeScript strict · react-i18next · Tailwind. Renderer-only.

**Spec:** `docs/superpowers/specs/2026-05-18-m16-interface-redesign-design.md` §6. Mockup: `docs/m16-mockups/flow-pedir-plano.html` variante 3 (split view). Base: HEAD `4310cb6` (M16 PR-C3 close).

---

## File map

**Modificados (renderer, 3):**
- `apps/renderer/src/i18n/en-US.json` — bloco `pedir.*` (4 chaves).
- `apps/renderer/src/i18n/pt-BR.json` — mirror.
- `apps/renderer/src/routes/GoalNew.tsx` — header reskin + 2-col layout. Form fields preservados.

**Total:** 3 modificados. ~3 tasks.

---

## Conventions

- Sempre `pnpm typecheck` antes de commitar.
- Pre-commit hook: prettier + eslint + gitleaks. Nunca `--no-verify`.
- Commits lowercase, ≤72 chars.
- Sem emojis — SVG inline.
- Identidade visual: Poppins, blue tokens.
- Renderer-only.

---

## Task 1: i18n `pedir.*` keys

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

- [ ] **Step 1: Add to `en-US.json`**

Add a new top-level `"pedir"` block (alphabetical):

```json
  "pedir": {
    "title": "Ask for something",
    "subtitle": "Describe what you need. The CEO will turn it into a plan and route it to the team.",
    "panel": {
      "title": "What happens next",
      "steps": [
        "You describe what you need below.",
        "The CEO reads it and proposes a plan.",
        "You approve, the team executes."
      ]
    }
  },
```

- [ ] **Step 2: Mirror in `pt-BR.json`**

```json
  "pedir": {
    "title": "Pedir algo",
    "subtitle": "Descreva o que você precisa. O CEO transforma em um plano e direciona a equipe.",
    "panel": {
      "title": "O que acontece em seguida",
      "steps": [
        "Você descreve o que precisa aqui.",
        "O CEO lê e propõe um plano.",
        "Você aprova, a equipe executa."
      ]
    }
  },
```

- [ ] **Step 3: Parity test + typecheck + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/i18n/parity.test.ts
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm --filter @prospero/renderer test
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(m16): add pedir i18n keys"
```

---

## Task 2: Reskin `GoalNew.tsx` header + 2-col layout

**Files:**
- Modify: `apps/renderer/src/routes/GoalNew.tsx`

Context: substituir o header existente (h1 "Novo objetivo" + form) por:
- Header com título "Pedir algo" + sub-linha narrativa
- Layout 2 colunas: form left (2/3 width), painel right (1/3 width) explicando os 3 steps
- Form fields intactos

Read current file first to confirm the header structure (linhas ~75-90). The existing form starts with `<form onSubmit={handleSubmit} className="space-y-4">` after a div with `max-w-2xl`.

- [ ] **Step 1: Read current header structure**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
Get-Content apps/renderer/src/routes/GoalNew.tsx -TotalCount 90
```

Confirm: container is `<div className="p-8 max-w-2xl">` with `<h1>` inside.

- [ ] **Step 2: Rewrite the return JSX**

Open `apps/renderer/src/routes/GoalNew.tsx`. Find the `return (` statement (around line 79). Replace the OUTER container from:

```typescript
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-2">{t("goals.new.title")}</h1>
      <p className="text-sm text-ink-muted mb-6">{t("goals.new.subtitle")}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
```

To:

```typescript
  return (
    <div className="p-8 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{t("pedir.title")}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t("pedir.subtitle")}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="space-y-4 lg:col-span-2">
```

(IMPORTANT: this opens a new `<div>` wrapper containing the form. We MUST close it at the end.)

Then at the END of the form's parent (right after the closing `</form>` and BEFORE the outer container's `</div>`), insert the right-side panel:

Find the existing closing pattern around line 230-232:

```typescript
        </div>
      </form>
    </div>
  );
};
```

Replace with:

```typescript
        </div>
      </form>

      <aside className="lg:col-span-1 bg-surface-card border border-surface-border rounded-xl p-5 h-fit lg:sticky lg:top-6">
        <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
          {t("pedir.panel.title")}
        </h2>
        <ol className="mt-3 space-y-3 text-sm text-ink">
          {(t("pedir.panel.steps", { returnObjects: true }) as string[]).map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-brand-bg text-brand text-xs font-bold flex items-center justify-center flex-shrink-0">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </aside>
      </div>
    </div>
  );
};
```

NOTE: `t(key, { returnObjects: true })` returns the array from i18next. The cast `as string[]` is because TFunction's return type is generic.

- [ ] **Step 3: Typecheck + lint + tests**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
```

Expected: green. The cast `as string[]` should compile under exactOptionalPropertyTypes.

- [ ] **Step 4: Commit**

```powershell
git add apps/renderer/src/routes/GoalNew.tsx
git commit -m "feat(m16): reskin goal new as pedir algo split view"
```

---

## Task 3: Final verification + push

- [ ] **Step 1: Full suite**

```powershell
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm test
```

Expected: 4 packages green; 1747 tests baseline.

- [ ] **Step 2: Push**

```powershell
git push origin main
```

Memory updated together with PR-E + PR-F when all 3 ship.

---

## Notes for the implementer

- **`goals.new.*` i18n keys ficam** — field labels, placeholders, etc. PR-D only changes the OUTER header + adds the panel.
- **Layout 2-col só em `lg:`** (>=1024px). Mobile/tablet stack vertically (`grid-cols-1`).
- **Aside é `lg:sticky`** pra acompanhar o scroll em telas grandes.
- **`returnObjects: true` em i18next** retorna o array literal do JSON. O cast `as string[]` é necessário pra TS strict.
- **Form fields intactos** — title, description, level, deadline, owner, parent, budget, criteria mantidos.
- **No emojis**.
- **Sem testes novos** — convenção renderer.
