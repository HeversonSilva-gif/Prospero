# M16 PR-F — Boas-vindas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Light reskin de `/setup` (SetupWizard.tsx, 242 LOC) pro vocabulário M16 §11 "Boas-vindas". O wizard já é step-by-step (5 steps: authSource → choose → manual/auto/apiKey). Só troca o título top-level e adiciona uma sub-linha mais amigável.

**Architecture:** Mudança minimal — 2 i18n keys novas (`boasVindas.title` + `boasVindas.subtitle`) + 2 linhas alteradas em SetupWizard.tsx (linhas 56-57). Steps + lógica intactos.

**Tech Stack:** React 18 · TypeScript strict · react-i18next.

**Spec:** §11 do M16. Mockup: `docs/m16-mockups/screen-onboarding.html`. Base: HEAD `bceb9df`.

---

## File map

**Modificados (3):**
- `apps/renderer/src/i18n/en-US.json` — `boasVindas.*` (2 chaves).
- `apps/renderer/src/i18n/pt-BR.json` — mirror.
- `apps/renderer/src/routes/SetupWizard.tsx` — linhas 56-57 trocam `wizard.title`/`wizard.subtitle` por `boasVindas.title`/`boasVindas.subtitle`.

---

## Task 1: i18n keys + reskin top-level (combined)

- [ ] **Step 1: Add to `en-US.json`** — top-level `"boasVindas"`:

```json
  "boasVindas": {
    "title": "Welcome",
    "subtitle": "Let's connect your account and get your company started."
  },
```

- [ ] **Step 2: Mirror in `pt-BR.json`**:

```json
  "boasVindas": {
    "title": "Boas-vindas",
    "subtitle": "Vamos conectar sua conta e começar sua empresa."
  },
```

- [ ] **Step 3: Edit SetupWizard.tsx**

Find OLD (lines 56-57):

```typescript
        <h1 className="text-2xl font-bold text-brand-dark mb-2">{t("wizard.title")}</h1>
        <p className="text-sm text-ink-muted mb-6">{t("wizard.subtitle")}</p>
```

Replace with:

```typescript
        <h1 className="text-2xl font-bold text-ink mb-2">{t("boasVindas.title")}</h1>
        <p className="text-sm text-ink-soft mb-6">{t("boasVindas.subtitle")}</p>
```

- [ ] **Step 4: Parity + typecheck + lint + tests + commit**

```powershell
cd "D:\Projetos pessoais\DashboardAgent\apps\renderer"
npx vitest run src/i18n/parity.test.ts
cd "D:\Projetos pessoais\DashboardAgent"
pnpm typecheck
pnpm lint
pnpm --filter @prospero/renderer test
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json apps/renderer/src/routes/SetupWizard.tsx
git commit -m "feat(m16): reskin setup as boas-vindas welcome"
```

- [ ] **Step 5: Push**

```powershell
git push origin main
```

---

## Notes

- **Step labels internos** (`wizard.authSource.*`, `wizard.manualSteps.*`, etc.) preservados. Apenas top-level chrome muda.
- **Step flow intacto** — authSource → choose → manual/auto/apiKey.
- **Sem testes novos** — convenção renderer.
- **Vocabulário interno** (Manual/Auto/API key) preservado — usuário técnico vai entender. Polish leigo total fica pra PR-G.
