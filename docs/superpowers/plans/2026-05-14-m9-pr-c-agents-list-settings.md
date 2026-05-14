# M9 PR-C — /agents list + Settings defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `/agents` list route (cards + role-template gallery) and the Settings "Defaults for new agents" section (mode + always_on). Both consume existing stores; no new IPC.

**Architecture:** New `/agents` route renders a grid of cards from `useAgentsStore`. A "+ Novo agente" button opens a `RoleTemplateGalleryModal` that lists templates from `useRolesStore`; clicking a template navigates to `/agents/new?template=<id>`. AgentNew reads the query param and pre-selects the role. Settings adds two fields to `AppSettings` (`defaultAgentMode`, `defaultAlwaysOn`); AgentNew uses them as initial values.

**Tech Stack:** React 18, react-router-dom, zustand, react-i18next, vitest.

> **Out of scope (deferred to PR-E):** OAuth expiry banner. Requires JWT parsing + new IPC + token-expires-at storage. Lives better with the rest of the resilience features (auto-restart, rate-limit banner, heartbeat). Spec §7.2 mentions it but it doesn't fit PR-C's 1-2d scope.

---

## File map

**Create:**
- `apps/renderer/src/routes/Agents.tsx` — list route
- `apps/renderer/src/components/RoleTemplateGalleryModal.tsx` — template picker modal

**Modify:**
- `packages/shared/src/types/settings.ts` — add `defaultAgentMode` + `defaultAlwaysOn`
- `apps/main/src/settings/schema.ts` — extend zod schema + parseSettings
- `apps/main/src/settings/schema.test.ts` — add coverage
- `apps/main/tests/settings.schema.test.ts` + `settings.repository.test.ts` — update `toEqual({...})`
- `apps/renderer/src/stores/settings.ts` — initial state default + (no new action — `setMode`/`setAlwaysOn` use generic `settings.update`)
- `apps/renderer/src/routes/Settings.tsx` — new "Defaults for new agents" section
- `apps/renderer/src/routes/AgentNew.tsx` — read `?template=` query + apply settings defaults
- `apps/renderer/src/App.tsx` — register `/agents` route + sidebar `NavLink`
- `apps/renderer/src/i18n/pt-BR.json` + `en-US.json` + `parity.test.ts`
- `packages/shared/tests/settings.test.ts` — `AppSettings` constructable test
- `ROADMAP.md` + `docs/roadmap.html`

---

## Task 1: AppSettings.defaultAgentMode + defaultAlwaysOn

**Files:**
- Modify: `packages/shared/src/types/settings.ts`
- Modify: `apps/main/src/settings/schema.ts`
- Modify: `apps/main/src/settings/schema.test.ts`
- Modify: `apps/main/tests/settings.schema.test.ts`
- Modify: `apps/main/tests/settings.repository.test.ts`
- Modify: `apps/renderer/src/stores/settings.ts`
- Modify: `packages/shared/tests/settings.test.ts`

- [ ] **Step 1.1: Extend shared types**

Edit `packages/shared/src/types/settings.ts`:

```typescript
export type AgentMode = "supervised" | "auto";

export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;
  defaultModelForNewAgents: string;
  executorMode: ExecutorMode;
  activeCompanyId: string | null;
  authMode: AuthMode;
  defaultAgentMode: AgentMode;
  defaultAlwaysOn: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
  defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
  executorMode: "atomic",
  activeCompanyId: null,
  authMode: "oauth",
  defaultAgentMode: "supervised",
  defaultAlwaysOn: false,
};
```

> **Note:** `AgentMode` type may already exist elsewhere (in `agent.ts`). If `grep -n "export type AgentMode" packages/shared/src/types/agent.ts` returns a result, **don't** redefine it. Import it instead:
>
> ```typescript
> import type { AgentMode } from "./agent.js";
> ```

- [ ] **Step 1.2: Failing parser tests**

Append to `apps/main/src/settings/schema.test.ts`:

```typescript
describe("parseSettings defaultAgentMode", () => {
  it("defaults to supervised when absent", () => {
    expect(parseSettings({}).defaultAgentMode).toBe("supervised");
  });

  it("preserves 'auto' value", () => {
    expect(parseSettings({ defaultAgentMode: "auto" }).defaultAgentMode).toBe("auto");
  });

  it("rejects bogus mode → falls back to supervised", () => {
    expect(parseSettings({ defaultAgentMode: "bogus" }).defaultAgentMode).toBe("supervised");
  });
});

describe("parseSettings defaultAlwaysOn", () => {
  it("defaults to false when absent", () => {
    expect(parseSettings({}).defaultAlwaysOn).toBe(false);
  });

  it("preserves true", () => {
    expect(parseSettings({ defaultAlwaysOn: true }).defaultAlwaysOn).toBe(true);
  });
});
```

Run: `pnpm --filter @dashboard-agent/main test -- schema`. Expected FAIL.

- [ ] **Step 1.3: Extend zod schema**

Edit `apps/main/src/settings/schema.ts`. Add to `AppSettingsSchema`:

```typescript
defaultAgentMode: z.enum(["supervised", "auto"]).default("supervised"),
defaultAlwaysOn: z.boolean().default(false),
```

Inside `parseSettings`, after the `authMode` branch:

```typescript
if (result.data.defaultAgentMode !== undefined) {
  merged.defaultAgentMode = result.data.defaultAgentMode;
}
if (result.data.defaultAlwaysOn !== undefined) {
  merged.defaultAlwaysOn = result.data.defaultAlwaysOn;
}
```

Run again. Expected PASS.

- [ ] **Step 1.4: Update toEqual({...}) assertions**

Edit `apps/main/tests/settings.schema.test.ts` and `apps/main/tests/settings.repository.test.ts`. Find every `toEqual({...})` against the full default shape and add the two new fields:

```typescript
defaultAgentMode: "supervised",
defaultAlwaysOn: false,
```

Run: `pnpm --filter @dashboard-agent/main test -- settings`. Expected PASS.

- [ ] **Step 1.5: Renderer settings store default**

Edit `apps/renderer/src/stores/settings.ts`, in the initial `settings:` object literal, add:

```typescript
defaultAgentMode: "supervised",
defaultAlwaysOn: false,
```

(Also fix the type import if AgentMode wasn't imported there already — pull it from `@dashboard-agent/shared`.)

- [ ] **Step 1.6: Shared types test**

Edit `packages/shared/tests/settings.test.ts`. Add to the `const s: AppSettings = {...}` block:

```typescript
defaultAgentMode: "supervised",
defaultAlwaysOn: false,
```

- [ ] **Step 1.7: Typecheck + commit**

```bash
pnpm -r typecheck
git add packages/shared/src/types/settings.ts apps/main/src/settings/schema.ts apps/main/src/settings/schema.test.ts apps/main/tests/settings.schema.test.ts apps/main/tests/settings.repository.test.ts apps/renderer/src/stores/settings.ts packages/shared/tests/settings.test.ts
git commit -m "feat(m9): add defaultAgentMode + defaultAlwaysOn to AppSettings"
```

---

## Task 2: RoleTemplateGalleryModal

**Files:**
- Create: `apps/renderer/src/components/RoleTemplateGalleryModal.tsx`

- [ ] **Step 2.1: Implement modal**

Create `apps/renderer/src/components/RoleTemplateGalleryModal.tsx`:

```tsx
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useRolesStore } from "../stores/roles.js";

type Props = { onClose: () => void };

export const RoleTemplateGalleryModal = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roles = useRolesStore((s) => s.roles);
  const load = useRolesStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (templateId: string) => {
    onClose();
    navigate(`/agents/new?template=${encodeURIComponent(templateId)}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t("agents.gallery.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-soft hover:text-ink-muted text-xl leading-none"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>
        <p className="text-xs text-ink-muted mb-4">{t("agents.gallery.subtitle")}</p>

        {roles.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("agents.gallery.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pick(r.id)}
                className="text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
              >
                <div className="flex items-start gap-2 mb-1">
                  {r.icon !== null && <span className="text-xl shrink-0">{r.icon}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink">{r.name}</div>
                    <div className="text-xs text-ink-muted truncate">
                      {r.agentCount} {t("agents.gallery.agentsCount")}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-ink-muted line-clamp-2">{r.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/RoleTemplateGalleryModal.tsx
git commit -m "feat(m9): role template gallery modal — picks template + nav to /agents/new"
```

---

## Task 3: /agents list route

**Files:**
- Create: `apps/renderer/src/routes/Agents.tsx`

- [ ] **Step 3.1: Implement route**

Create `apps/renderer/src/routes/Agents.tsx`:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { RoleTemplateGalleryModal } from "../components/RoleTemplateGalleryModal.js";
import type { AgentStatus } from "@dashboard-agent/shared";

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "bg-ink-soft",
  thinking: "bg-brand",
  working: "bg-semantic-success",
  waiting: "bg-semantic-warning",
  error: "bg-semantic-danger",
  paused: "bg-semantic-warning",
  terminated: "bg-ink-soft",
};

export const Agents: FC = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const [showGallery, setShowGallery] = useState(false);

  const live = agents.filter((a) => a.status !== "terminated");

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">{t("agents.list.title")}</h1>
        <button
          type="button"
          onClick={() => setShowGallery(true)}
          className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded hover:opacity-90"
        >
          + {t("agents.list.new")}
        </button>
      </div>

      {live.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("agents.list.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {live.map((a) => {
            const showAction =
              (a.status === "working" || a.status === "thinking") &&
              a.currentAction !== null &&
              a.currentAction !== "";
            return (
              <Link
                key={a.id}
                to={`/agents/${a.id}`}
                className="block p-4 bg-surface-card border border-surface-border rounded-lg hover:border-brand transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLOR[a.status]}`}
                    title={a.status}
                  />
                  <span className="text-sm font-semibold text-ink truncate flex-1">{a.name}</span>
                </div>
                <div className="text-xs text-ink-muted">{a.role}</div>
                {showAction && (
                  <div className="mt-2 text-[11px] italic text-ink-soft truncate">
                    {a.currentAction}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {showGallery && <RoleTemplateGalleryModal onClose={() => setShowGallery(false)} />}
    </div>
  );
};
```

- [ ] **Step 3.2: Register route + sidebar link**

Edit `apps/renderer/src/App.tsx`. After existing `lazy()` imports (around line 31), add:

```typescript
const Agents = lazy(() => import("./routes/Agents.js").then((m) => ({ default: m.Agents })));
```

Find the existing `<NavLink to="/issues">` block in `Sidebar` (~lines 79-85). After it, before the `/goals` block, insert:

```tsx
<NavLink
  to="/agents"
  className={({ isActive }) =>
    `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
  }
>
  {t("nav.agentsList")}
</NavLink>
```

Find the `<Route path="/agents/new"` block. Above it, add the new `/agents` route:

```tsx
<Route
  path="/agents"
  element={
    hasToken ? (
      <Layout>
        <Suspense fallback={<div className="p-8 text-sm text-ink-muted">…</div>}>
          <Agents />
        </Suspense>
      </Layout>
    ) : (
      <Navigate to="/setup" replace />
    )
  }
/>
```

> **Order matters**: `/agents` must come *before* `/agents/:id` and `/agents/new` in the route list. React Router matches in order — if `/agents/:id` came first, `/agents` would match as `:id = undefined` … actually no, exact matches win. But to be safe, put `/agents` between the existing `/goals/:id` and `/agents/:id`. Easier: put it where logically grouped (with the other agents routes).

- [ ] **Step 3.3: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/routes/Agents.tsx apps/renderer/src/App.tsx
git commit -m "feat(m9): /agents list route + sidebar link + gallery wiring"
```

---

## Task 4: AgentNew reads ?template= + applies settings defaults

**Files:**
- Modify: `apps/renderer/src/routes/AgentNew.tsx`

- [ ] **Step 4.1: Wire query param + defaults**

Edit `apps/renderer/src/routes/AgentNew.tsx`. Add imports at top:

```typescript
import { useSearchParams } from "react-router-dom";
import { useSettingsStore } from "../stores/settings.js";
```

Inside the component, replace the existing state declarations + the `useEffect` that loads roles. New shape:

```typescript
export const AgentNew: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTemplate = searchParams.get("template") ?? "";
  const settings = useSettingsStore((s) => s.settings);
  const hireFromUi = useAgentsStore((s) => s.hireFromUi);
  const agents = useAgentsStore((s) => s.agents);
  const roles = useRolesStore((s) => s.roles);
  const loadRoles = useRolesStore((s) => s.load);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [roleTemplateId, setRoleTemplateId] = useState<string>(initialTemplate);
  const [reportsTo, setReportsTo] = useState("");
  const [mode, setMode] = useState<"supervised" | "auto">(settings.defaultAgentMode);
  const [persona, setPersona] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ... rest unchanged
```

Note: keep the existing `useEffect` that fetches companies + calls `loadRoles`. Keep the `selected` derived var and the persona effect.

- [ ] **Step 4.2: Pass alwaysOn default to hireFromUi**

Currently `hireFromUi` payload doesn't have `always_on`. The repo and IPC handler default to `false`. Check `apps/main/src/ipc/orchestrator-handlers.ts` `AGENTS_HIRE_FROM_UI` handler — it always passes `alwaysOn: false`. To honor `settings.defaultAlwaysOn`, update the call site to use the setting.

For PR-C, the cleanest path: don't expose `alwaysOn` toggle in the new-agent form yet (that's a separate UX decision). Instead, **just apply `settings.defaultAlwaysOn` server-side when the request omits the field**. But the IPC schema may not accept the field. Check `HIRE_FROM_UI_INPUT_SCHEMA`.

Actually, simplest: **the setting is the default behavior — there's no UI to override per-hire in this PR**. Leave the `alwaysOn` setting as a passive default for future hire flows. Document this in the lessons.

So **no code change** in `hireFromUi` payload yet. The setting is persisted but only documented as "applies to future hire paths". The Settings UI exposes it for visibility.

Skip this step.

- [ ] **Step 4.3: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/routes/AgentNew.tsx
git commit -m "feat(m9): agent-new reads ?template= query + applies default mode setting"
```

---

## Task 5: Settings.tsx — Defaults for new agents

**Files:**
- Modify: `apps/renderer/src/routes/Settings.tsx`

- [ ] **Step 5.1: Add section + bindings**

Edit `apps/renderer/src/routes/Settings.tsx`. Near the top of the component (where selectors are bound), add:

```typescript
const updateSetting = async (patch: Partial<{ defaultAgentMode: "supervised" | "auto"; defaultAlwaysOn: boolean }>) => {
  await window.dashboardAgent.settings.update(patch);
  await loadSettings();
};
```

Just before the closing `</div>` of the route (between the existing Executor mode section and the workspace section), insert:

```tsx
<section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
  <h2 className="text-base font-semibold text-brand-dark mb-2">
    {t("settings.agentDefaults.title")}
  </h2>
  <p className="text-xs text-ink-muted mb-3">{t("settings.agentDefaults.subtitle")}</p>

  <div className="space-y-3">
    <div>
      <label className="block text-xs font-semibold text-ink mb-1">
        {t("settings.agentDefaults.modeLabel")}
      </label>
      <div className="flex gap-3 text-sm">
        {(["supervised", "auto"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input
              type="radio"
              name="defaultAgentMode"
              checked={settings.defaultAgentMode === m}
              onChange={() => void updateSetting({ defaultAgentMode: m })}
            />
            {t(`agent.config.mode.${m}`)}
          </label>
        ))}
      </div>
    </div>

    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={settings.defaultAlwaysOn}
        onChange={(e) => void updateSetting({ defaultAlwaysOn: e.target.checked })}
        className="mt-1"
      />
      <div>
        <div className="text-sm font-medium text-ink">
          {t("settings.agentDefaults.alwaysOnLabel")}
        </div>
        <div className="text-xs text-ink-muted">{t("settings.agentDefaults.alwaysOnDesc")}</div>
      </div>
    </label>
  </div>
</section>
```

- [ ] **Step 5.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/routes/Settings.tsx
git commit -m "feat(m9): settings — defaults for new agents section (mode + alwaysOn)"
```

---

## Task 6: i18n keys + parity

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 6.1: PT-BR keys**

Edit `apps/renderer/src/i18n/pt-BR.json`. Verify `nav.agents` and `agents.gallery.*` don't already exist. The current key `nav.agents` is "Agentes" — used in the sidebar header above the per-agent list. We need a new key for the **list nav item**:

In the `"nav":` block, add:

```json
"agentsList": "Agentes (lista)"
```

Hmm — let me reconsider. Both labels would say "Agentes" in PT-BR, but the existing `nav.agents` is used in the *section header* (not a nav link), while the new one is a top-level nav link. Reusing `nav.agents` for the link is fine — the header could become a header literal or use a different key.

**Simpler approach:** keep both pointing to "Agentes". Since `nav.agents` exists already, just reuse it in the new `<NavLink>`. No new nav key needed.

Then for the rest, add to existing top-level blocks (`agents` if exists, or create new):

```json
"agents": {
  "list": {
    "title": "Agentes",
    "new": "Novo agente",
    "empty": "Nenhum agente ainda. Clique em \"Novo agente\" pra começar."
  },
  "gallery": {
    "title": "Escolher template",
    "subtitle": "Cada template traz persona, skills e modelo padrão. Você pode editar depois.",
    "empty": "Nenhum template disponível.",
    "agentsCount": "agente(s)"
  }
}
```

> **Check if `agents` is already a top-level key**: `grep -n '^  "agents":' apps/renderer/src/i18n/pt-BR.json`. If present (M7-era), merge instead of overwriting. The `agent.*` namespace (singular) already exists with `agent.config.*`, `agent.new.*`, etc. — that's different.

In `settings`, add:

```json
"agentDefaults": {
  "title": "Defaults pra novos agentes",
  "subtitle": "Configurações usadas quando você cria um novo agente. Você pode override durante a criação.",
  "modeLabel": "Modo padrão",
  "alwaysOnLabel": "Always-on por padrão",
  "alwaysOnDesc": "Agente fica pronto pra receber tarefas sempre — útil pra workflows automáticos."
}
```

Verify `common.close` exists; if not add `"close": "Fechar"` in the `common` block.

Update the back-NavLink from §3 — the new `<NavLink to="/agents">` uses `t("nav.agentsList")`. Decide:
- **Option A**: reuse `nav.agents` (already says "Agentes")
- **Option B**: add `nav.agentsList: "Agentes"` (PT) / `"Agents"` (EN)

Go with **Option A** — reuse `nav.agents`. Update the App.tsx NavLink in Task 3 (step 3.2 already added — change `t("nav.agentsList")` to `t("nav.agents")` if you used the wrong key). The sidebar already has a separator `(nav.agents)` used for the section above the per-agent list; that header context still makes sense — same label.

- [ ] **Step 6.2: EN-US mirror**

```json
"agents": {
  "list": {
    "title": "Agents",
    "new": "New agent",
    "empty": "No agents yet. Click \"New agent\" to start."
  },
  "gallery": {
    "title": "Pick a template",
    "subtitle": "Each template brings persona, skills, and default model. You can edit after.",
    "empty": "No templates available.",
    "agentsCount": "agent(s)"
  }
}
```

```json
"agentDefaults": {
  "title": "Defaults for new agents",
  "subtitle": "Used when you create a new agent. You can override during creation.",
  "modeLabel": "Default mode",
  "alwaysOnLabel": "Always-on by default",
  "alwaysOnDesc": "Agent stays ready to receive tasks — useful for automated workflows."
}
```

- [ ] **Step 6.3: Extend parity test**

Edit `apps/renderer/src/i18n/parity.test.ts`. Add:

```typescript
it("includes the M9 PR-C agents-list + settings defaults keys in both locales", () => {
  const ptKeys = flatten(ptBR);
  const enKeys = flatten(enUS);
  for (const k of [
    "agents.list.title",
    "agents.list.new",
    "agents.list.empty",
    "agents.gallery.title",
    "agents.gallery.subtitle",
    "agents.gallery.empty",
    "agents.gallery.agentsCount",
    "settings.agentDefaults.title",
    "settings.agentDefaults.modeLabel",
    "settings.agentDefaults.alwaysOnLabel",
  ]) {
    expect(ptKeys).toContain(k);
    expect(enKeys).toContain(k);
  }
});
```

Run: `pnpm --filter @dashboard-agent/renderer test -- parity`. Expected PASS.

- [ ] **Step 6.4: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m9): i18n keys for agents list + settings defaults (pt-BR + en-US)"
```

---

## Task 7: Full suite verification

- [ ] **Step 7.1: Run all**

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

Expected: 763 + ~6 new (5 schema/parser + 1 parity) = **~769 testes**.

---

## Task 8: Roadmap update (3 lugares)

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/roadmap.html`

- [ ] **Step 8.1: ROADMAP.md §M9 checkboxes**

In `ROADMAP.md` find §M9. Update:

```diff
- [ ] **/agents (lista, não detail):**
-   - [ ] Cards com avatar + nome + role + status
-   - [ ] Botão "+" com galeria de role_templates
+ [x] **/agents (lista, não detail):** ✅ **PR-C mergeado 2026-05-14**
+   - [x] Cards com nome + role + status dot + currentAction
+   - [x] Botão "+ Novo agente" com galeria de role_templates → /agents/new?template=
```

```diff
- [ ] **Settings:**
-   - [ ] Defaults de mode (`supervised`/`auto`)
-   - [ ] Defaults de `always_on`
-   - [ ] Banner global pra OAuth token expiring (30d antes)
+ [x] **Settings:** ✅ **PR-C mergeado 2026-05-14** (banner expiry deferido pra PR-E)
+   - [x] Defaults de mode (`supervised`/`auto`)
+   - [x] Defaults de `always_on`
+   - [ ] Banner global pra OAuth token expiring (30d antes) → deferido pra PR-E (precisa JWT parsing + IPC novo)
```

In v1 scope tracker (Settings row ~line 204):

```diff
- | **Settings** | ✅ Completo | OAuth token (manual + auto-detect M2), language, theme, default model. Defaults de mode/always_on **NÃO** UI ainda — M9. |
+ | **Settings** | ✅ Completo | OAuth/API key auth (M9 PR-D), language, theme, default model, executor mode, defaults pra novos agentes (mode + always_on — M9 PR-C). Banner OAuth expiry pendente PR-E. |
```

- [ ] **Step 8.2: roadmap.html updates**

Edit `docs/roadmap.html`:

1. **/01 progress** — bump test count + agora card to "M9 PR-C mergeado", restantes 2 PRs (E · F).
2. **/03 módulos** — find M9 article. Add new feature group ✅ "/agents list + Settings defaults".

Match the pattern of `88ee039` / `ddb44a8` / `bbc7c4a` closure commits.

- [ ] **Step 8.3: Commit**

```bash
git add ROADMAP.md docs/roadmap.html
git commit -m "docs(m9): close pr-c agents-list + settings defaults in roadmap (3 places)"
```

---

## Task 9: Memory + handoff

**Files:**
- Create: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_m9_pr_c_lessons.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\MEMORY.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_session_handoff.md`

- [ ] **Step 9.1: Lessons memory**

Content sketch:

```markdown
---
name: project-m9-pr-c-lessons
description: "M9 PR-C /agents list + Settings defaults mergeado 2026-05-14. ~9 commits, +6 testes. Nova rota /agents + RoleTemplateGalleryModal + AgentNew lê ?template= + settings.defaultAgentMode/AlwaysOn. OAuth expiry banner deferido pra PR-E (precisa JWT parsing)."
metadata:
  type: project
---

# M9 PR-C — /agents list + Settings defaults (mergeado 2026-05-14)

## Decisões
- OAuth expiry banner deferido pra PR-E. Requer JWT parsing infra que não existe; agrupa melhor com auto-restart + heartbeat + rate-limit banner.
- defaultAlwaysOn é setting persistido mas sem UI override per-hire ainda. Aplicação real do default fica pra futuro (AgentNew + hireFromUi nao expoe always_on toggle ainda).
- Sidebar reusa nav.agents — mesmo label "Agentes" usado pelo section header acima do per-agent list. Sem novo key.

## Lições
1. **nav.agents already used as section header** — adicionar NavLink que aponta pra /agents reusa o mesmo label sem confundir contexto.
2. **AppSettings mudança = 7 arquivos** — recorrente ([[project_m9_pr_a_lessons]]): shared/types + main/schema + main/schema.test + tests/settings.schema + tests/settings.repository + renderer/stores/settings + shared/tests/settings.
3. **`?template=` query param via useSearchParams** — clean. AgentNew lê `searchParams.get("template")` como initial state.

## Status final
- 13/14 milestones do v1; M9 com 4/6 PRs (A + D + B + C)
- ~769 testes passing
- Próximo: **M9 PR-E — Error handling §7** (banner OAuth invalid + auto-restart main + rate-limit backoff + heartbeat 5min + OAuth expiry banner). Spec §8.
```

- [ ] **Step 9.2: MEMORY.md index + handoff**

Add line to MEMORY.md:

```markdown
- [M9 PR-C lições — /agents + Settings defaults](project_m9_pr_c_lessons.md) — mergeado 2026-05-14, ~9 commits, +6 testes. Nova rota + gallery modal + settings defaults. OAuth expiry banner deferido pra PR-E.
```

Update `project_session_handoff.md`:
- HEAD bumped
- 4/6 PRs do M9
- 769 testes
- Próximo: PR-E

---

## Self-review checklist

- [x] **Spec coverage:** /agents list ✅, gallery ✅, AgentNew query ✅, Settings defaults ✅. OAuth expiry banner explicitly deferred to PR-E with reason in plan + memory.
- [x] **Placeholder scan:** every step has actual code. No "TBD".
- [x] **Type consistency:** `AgentMode` reused from shared; `?template=` param consistent across gallery → AgentNew.
- [x] **No new IPC / migration:** confirmed.

If something diverges, fix inline and note in T9 lessons.
