# M9 PR-A — Multi-empresa Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `companies[0]!` first-company assumption with a real switcher: store + dropdown + create/delete modals + active company persisted in settings. After this PR, the user can have N companies and switch between them.

**Architecture:** Backend adds `delete()` to repo + 2 new IPCs (`company:create`, `company:delete`). Settings gains an `activeCompanyId: string | null` field — no DDL needed (settings is JSON blob). Renderer ships a new `useCompaniesStore` (zustand) that owns `activeId`, a `<CompanySwitcher />` at the sidebar top, and two modals. `App.tsx` replaces 3 `companies[0]!` call sites with `useCompaniesStore`.

**Tech Stack:** Electron + better-sqlite3, zod (apps/main only), zustand, React 18, react-i18next, Tailwind, vitest.

---

## File map

**Create:**
- `apps/renderer/src/stores/companies.ts` — new store
- `apps/renderer/src/stores/companies.test.ts` — store tests
- `apps/renderer/src/components/CompanySwitcher.tsx` — sidebar dropdown
- `apps/renderer/src/components/CreateCompanyModal.tsx`
- `apps/renderer/src/components/DeleteCompanyConfirm.tsx`
- `apps/main/src/companies/repository.test.ts` — repo tests (delete + cascade)
- `apps/main/src/ipc/companies-handlers.test.ts` — IPC handler tests

**Modify:**
- `packages/shared/src/types/settings.ts` — add `activeCompanyId` to `AppSettings` + `DEFAULT_SETTINGS`
- `packages/shared/src/ipc-channels.ts` — add `COMPANY_CREATE` + `COMPANY_DELETE`
- `apps/main/src/settings/schema.ts` — add `activeCompanyId` to `AppSettingsSchema` + `parseSettings`
- `apps/main/src/companies/repository.ts` — add `delete(id)` method
- `apps/main/src/ipc/companies-handlers.ts` — register create + delete IPCs
- `apps/main/src/ipc/preload.ts` — expose `companies.create` + `companies.delete`
- `apps/renderer/src/env.d.ts` — extend `companies` interface
- `apps/renderer/src/App.tsx` — use store instead of `companies[0]!`
- `apps/renderer/src/routes/Dashboard.tsx` — use store
- `apps/renderer/src/i18n/pt-BR.json` + `en-US.json` — ~10 new keys
- `apps/renderer/src/i18n/parity.test.ts` — extend assertions

---

## Task 1: AppSettings.activeCompanyId field (shared types + schema)

**Files:**
- Modify: `packages/shared/src/types/settings.ts`
- Modify: `apps/main/src/settings/schema.ts`
- Test: `apps/main/src/settings/schema.test.ts` (create if not exists)

- [ ] **Step 1.1: Add field to shared types**

Edit `packages/shared/src/types/settings.ts`. Update `AppSettings` type and `DEFAULT_SETTINGS`:

```typescript
export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;
  defaultModelForNewAgents: string;
  executorMode: ExecutorMode;
  activeCompanyId: string | null;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
  defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
  executorMode: "atomic",
  activeCompanyId: null,
};
```

- [ ] **Step 1.2: Write failing schema parser test**

Check if `apps/main/src/settings/schema.test.ts` exists. If not, create it with:

```typescript
import { describe, expect, it } from "vitest";
import { parseSettings } from "./schema.js";

describe("parseSettings activeCompanyId", () => {
  it("defaults to null when absent", () => {
    const parsed = parseSettings({});
    expect(parsed.activeCompanyId).toBeNull();
  });

  it("preserves a valid string id", () => {
    const parsed = parseSettings({ activeCompanyId: "co_abc123" });
    expect(parsed.activeCompanyId).toBe("co_abc123");
  });

  it("preserves explicit null", () => {
    const parsed = parseSettings({ activeCompanyId: null });
    expect(parsed.activeCompanyId).toBeNull();
  });
});
```

If the file already exists, just append the `describe` block at the end (keep existing tests).

- [ ] **Step 1.3: Run the test to confirm it fails**

```bash
pnpm --filter @dashboard-agent/main test -- schema
```

Expected: FAIL — `activeCompanyId` is `undefined` because schema doesn't recognize it.

- [ ] **Step 1.4: Extend the schema and parser**

Edit `apps/main/src/settings/schema.ts`:

```typescript
export const AppSettingsSchema = z.object({
  language: z.enum(["pt-BR", "en-US"]),
  theme: z.enum(["light", "dark"]),
  workspaceCwd: z.string().nullable().default(null),
  defaultModelForNewAgents: z.string().regex(MODEL_ID_REGEX).default(DEFAULT_CLAUDE_MODEL),
  executorMode: z.enum(["atomic", "narrated"]).default("atomic"),
  activeCompanyId: z.string().nullable().default(null),
});
```

And inside `parseSettings`, after the `executorMode` branch:

```typescript
if (result.data.activeCompanyId !== undefined) {
  merged.activeCompanyId = result.data.activeCompanyId;
}
```

- [ ] **Step 1.5: Run the test to confirm it passes**

```bash
pnpm --filter @dashboard-agent/main test -- schema
```

Expected: PASS — all 3 new assertions green.

- [ ] **Step 1.6: Run shared typecheck**

```bash
pnpm --filter @dashboard-agent/shared typecheck
pnpm --filter @dashboard-agent/main typecheck
```

Expected: clean. The new field is non-optional but `DEFAULT_SETTINGS` provides it, so existing call sites stay valid.

- [ ] **Step 1.7: Commit**

```bash
git add packages/shared/src/types/settings.ts apps/main/src/settings/schema.ts apps/main/src/settings/schema.test.ts
git commit -m "feat(m9): add activeCompanyId to AppSettings shape + schema"
```

---

## Task 2: Companies repository delete method

**Files:**
- Modify: `apps/main/src/companies/repository.ts`
- Create: `apps/main/src/companies/repository.test.ts`

- [ ] **Step 2.1: Write failing test for delete + cascade**

Create `apps/main/src/companies/repository.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompaniesRepository } from "./repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

describe("companies repository", () => {
  it("create + list returns the inserted company", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const created = repo.create({ name: "Acme" });
    expect(created.name).toBe("Acme");
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0]!.id).toBe(created.id);
  });

  it("delete removes the company row", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const co = repo.create({ name: "ToDelete" });
    repo.delete(co.id);
    expect(repo.getById(co.id)).toBeNull();
    expect(repo.list()).toHaveLength(0);
  });

  it("delete cascades to agents", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const co = repo.create({ name: "WithAgent" });
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, mode, always_on, status, model, skills_json, created_at)
       VALUES ('ag_1', ?, 'CEO', 'orch', 'p', 'supervised', 0, 'idle', 'claude-sonnet-4-6', '[]', 0)`,
    ).run(co.id);
    expect(
      db.prepare("SELECT COUNT(*) as n FROM agents WHERE company_id = ?").get(co.id),
    ).toEqual({ n: 1 });
    repo.delete(co.id);
    expect(
      db.prepare("SELECT COUNT(*) as n FROM agents WHERE company_id = ?").get(co.id),
    ).toEqual({ n: 0 });
  });

  it("delete on nonexistent id is a no-op (no throw)", () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    expect(() => repo.delete("co_doesnotexist")).not.toThrow();
  });
});
```

- [ ] **Step 2.2: Run the test to confirm it fails**

```bash
pnpm --filter @dashboard-agent/main test -- companies/repository
```

Expected: FAIL — `repo.delete` doesn't exist on the type.

- [ ] **Step 2.3: Add delete method to repository**

Edit `apps/main/src/companies/repository.ts`. Update the type and impl:

```typescript
export type CompaniesRepository = {
  create(input: { name: string }): Company;
  getById(id: string): Company | null;
  list(): Company[];
  delete(id: string): void;
};
```

Inside `createCompaniesRepository`, prepare a new statement before the `return`:

```typescript
const deleteStmt = db.prepare("DELETE FROM companies WHERE id = ?");
```

And add to the returned object:

```typescript
delete(id) {
  deleteStmt.run(id);
},
```

- [ ] **Step 2.4: Run the test to confirm it passes**

```bash
pnpm --filter @dashboard-agent/main test -- companies/repository
```

Expected: PASS — 4 assertions green. The cascade test relies on the FK already declared in `0001_initial.sql` (`agents.company_id REFERENCES companies(id) ON DELETE CASCADE`).

> **If the cascade test fails:** open `apps/main/src/db/migrations/0001_initial.sql`, find the `agents` table definition, confirm `ON DELETE CASCADE` is on `company_id`. If not, that's an unrelated bug — flag to user before continuing.

- [ ] **Step 2.5: Commit**

```bash
git add apps/main/src/companies/repository.ts apps/main/src/companies/repository.test.ts
git commit -m "feat(m9): add delete to companies repository + cascade test"
```

---

## Task 3: IPC channels + handlers (create + delete)

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `apps/main/src/ipc/companies-handlers.ts`
- Create: `apps/main/src/ipc/companies-handlers.test.ts`

- [ ] **Step 3.1: Add IPC channel constants**

Edit `packages/shared/src/ipc-channels.ts`. After `COMPANY_CREATE_DEMO`:

```typescript
COMPANY_CREATE: "company:create",
COMPANY_DELETE: "company:delete",
```

- [ ] **Step 3.2: Write failing handler test**

Create `apps/main/src/ipc/companies-handlers.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompaniesRepository } from "../companies/repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Capture ipcMain.handle calls without booting Electron.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown): void => {
      handlers.set(ch, fn);
    },
  },
}));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

beforeEach(() => {
  handlers.clear();
});

describe("companies handlers", () => {
  it("company:create inserts and returns the new company", async () => {
    const db = setupDb();
    const { registerCompaniesHandlers } = await import("./companies-handlers.js");
    registerCompaniesHandlers(db);
    const handle = handlers.get("company:create");
    expect(handle).toBeDefined();
    const result = (await handle!(null, { name: "Foo" })) as { id: string; name: string };
    expect(result.name).toBe("Foo");
    expect(createCompaniesRepository(db).list()).toHaveLength(1);
  });

  it("company:create rejects empty name", async () => {
    const db = setupDb();
    const { registerCompaniesHandlers } = await import("./companies-handlers.js");
    registerCompaniesHandlers(db);
    const handle = handlers.get("company:create");
    await expect(handle!(null, { name: "" })).rejects.toThrow(/name/);
    await expect(handle!(null, { name: "   " })).rejects.toThrow(/name/);
  });

  it("company:delete removes the row and cascades", async () => {
    const db = setupDb();
    const repo = createCompaniesRepository(db);
    const co = repo.create({ name: "ToDel" });
    const { registerCompaniesHandlers } = await import("./companies-handlers.js");
    registerCompaniesHandlers(db);
    const handle = handlers.get("company:delete");
    expect(handle).toBeDefined();
    await handle!(null, { id: co.id });
    expect(repo.getById(co.id)).toBeNull();
  });
});
```

- [ ] **Step 3.3: Run the test to confirm it fails**

```bash
pnpm --filter @dashboard-agent/main test -- ipc/companies-handlers
```

Expected: FAIL — handlers for `company:create` and `company:delete` are not registered.

- [ ] **Step 3.4: Implement the new handlers**

Edit `apps/main/src/ipc/companies-handlers.ts`. Replace the file with:

```typescript
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Company } from "@dashboard-agent/shared";
import { createCompaniesRepository } from "../companies/repository.js";
import { createDemoCompany } from "../companies/seed.js";

export const registerCompaniesHandlers = (db: Database.Database): void => {
  const repo = createCompaniesRepository(db);

  ipcMain.handle(IPC.COMPANY_LIST, (): Company[] => repo.list());

  ipcMain.handle(IPC.COMPANY_CREATE_DEMO, (): Company => createDemoCompany(db));

  ipcMain.handle(IPC.COMPANY_CREATE, (_e, payload: { name: string }): Company => {
    const trimmed = payload.name.trim();
    if (trimmed.length === 0) {
      throw new Error("[company:create] name is required");
    }
    return repo.create({ name: trimmed });
  });

  ipcMain.handle(IPC.COMPANY_DELETE, (_e, payload: { id: string }): { ok: true } => {
    if (typeof payload.id !== "string" || payload.id.length === 0) {
      throw new Error("[company:delete] id is required");
    }
    repo.delete(payload.id);
    return { ok: true };
  });
};
```

- [ ] **Step 3.5: Run the test to confirm it passes**

```bash
pnpm --filter @dashboard-agent/main test -- ipc/companies-handlers
```

Expected: PASS — all 3 assertions green.

- [ ] **Step 3.6: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/companies-handlers.ts apps/main/src/ipc/companies-handlers.test.ts
git commit -m "feat(m9): companies create + delete ipc handlers with validation"
```

---

## Task 4: Preload bridge + renderer types

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 4.1: Extend preload bridge**

Edit `apps/main/src/ipc/preload.ts`. Find the `companies:` block (around lines 60-63) and replace with:

```typescript
companies: {
  list: () => ipcRenderer.invoke(IPC.COMPANY_LIST) as Promise<Company[]>,
  createDemo: () => ipcRenderer.invoke(IPC.COMPANY_CREATE_DEMO) as Promise<Company>,
  create: (name: string) =>
    ipcRenderer.invoke(IPC.COMPANY_CREATE, { name }) as Promise<Company>,
  delete: (id: string) =>
    ipcRenderer.invoke(IPC.COMPANY_DELETE, { id }) as Promise<{ ok: true }>,
},
```

- [ ] **Step 4.2: Extend renderer type declarations**

Edit `apps/renderer/src/env.d.ts`. Find the `companies` interface block (~line 56-59) and replace with:

```typescript
companies: {
  list: () => Promise<Company[]>;
  createDemo: () => Promise<Company>;
  create: (name: string) => Promise<Company>;
  delete: (id: string) => Promise<{ ok: true }>;
};
```

- [ ] **Step 4.3: Typecheck both packages**

```bash
pnpm --filter @dashboard-agent/main typecheck
pnpm --filter @dashboard-agent/renderer typecheck
```

Expected: clean.

- [ ] **Step 4.4: Commit**

```bash
git add apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m9): expose companies create + delete via preload bridge"
```

---

## Task 5: Renderer companies store

**Files:**
- Create: `apps/renderer/src/stores/companies.ts`
- Create: `apps/renderer/src/stores/companies.test.ts`

- [ ] **Step 5.1: Write failing store tests**

Create `apps/renderer/src/stores/companies.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useCompaniesStore } from "./companies.js";

const ipcMock = {
  companies: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    update: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  (
    globalThis as unknown as { window: { dashboardAgent: typeof ipcMock } }
  ).window = { dashboardAgent: ipcMock };
  useCompaniesStore.setState({ companies: [], activeId: null, loaded: false });
});

const co = (id: string, name: string) => ({ id, name, createdAt: 0 });

describe("useCompaniesStore", () => {
  it("load fetches companies and seeds activeId from settings", async () => {
    ipcMock.companies.list.mockResolvedValue([co("co_1", "A"), co("co_2", "B")]);
    ipcMock.settings.get.mockResolvedValue({ activeCompanyId: "co_2" });
    await useCompaniesStore.getState().load();
    expect(useCompaniesStore.getState().companies).toHaveLength(2);
    expect(useCompaniesStore.getState().activeId).toBe("co_2");
    expect(useCompaniesStore.getState().loaded).toBe(true);
  });

  it("load falls back to first company when settings has no activeCompanyId", async () => {
    ipcMock.companies.list.mockResolvedValue([co("co_1", "A"), co("co_2", "B")]);
    ipcMock.settings.get.mockResolvedValue({ activeCompanyId: null });
    await useCompaniesStore.getState().load();
    expect(useCompaniesStore.getState().activeId).toBe("co_1");
  });

  it("load with zero companies leaves activeId null", async () => {
    ipcMock.companies.list.mockResolvedValue([]);
    ipcMock.settings.get.mockResolvedValue({ activeCompanyId: null });
    await useCompaniesStore.getState().load();
    expect(useCompaniesStore.getState().activeId).toBeNull();
  });

  it("create inserts via IPC and makes the new company active", async () => {
    ipcMock.companies.create.mockResolvedValue(co("co_new", "New"));
    ipcMock.settings.update.mockResolvedValue({ activeCompanyId: "co_new" });
    useCompaniesStore.setState({ companies: [co("co_1", "A")], activeId: "co_1", loaded: true });
    const created = await useCompaniesStore.getState().create("New");
    expect(created.id).toBe("co_new");
    expect(useCompaniesStore.getState().companies).toHaveLength(2);
    expect(useCompaniesStore.getState().activeId).toBe("co_new");
    expect(ipcMock.settings.update).toHaveBeenCalledWith({ activeCompanyId: "co_new" });
  });

  it("delete removes the company and falls back to first remaining when deleting active", async () => {
    useCompaniesStore.setState({
      companies: [co("co_1", "A"), co("co_2", "B"), co("co_3", "C")],
      activeId: "co_2",
      loaded: true,
    });
    ipcMock.companies.delete.mockResolvedValue({ ok: true });
    ipcMock.settings.update.mockResolvedValue({ activeCompanyId: "co_1" });
    await useCompaniesStore.getState().delete("co_2");
    expect(useCompaniesStore.getState().companies.map((c) => c.id)).toEqual(["co_1", "co_3"]);
    expect(useCompaniesStore.getState().activeId).toBe("co_1");
  });

  it("delete the only company sets activeId to null", async () => {
    useCompaniesStore.setState({
      companies: [co("co_1", "A")],
      activeId: "co_1",
      loaded: true,
    });
    ipcMock.companies.delete.mockResolvedValue({ ok: true });
    ipcMock.settings.update.mockResolvedValue({ activeCompanyId: null });
    await useCompaniesStore.getState().delete("co_1");
    expect(useCompaniesStore.getState().companies).toEqual([]);
    expect(useCompaniesStore.getState().activeId).toBeNull();
  });

  it("setActive persists via settings.update", async () => {
    useCompaniesStore.setState({
      companies: [co("co_1", "A"), co("co_2", "B")],
      activeId: "co_1",
      loaded: true,
    });
    ipcMock.settings.update.mockResolvedValue({ activeCompanyId: "co_2" });
    await useCompaniesStore.getState().setActive("co_2");
    expect(useCompaniesStore.getState().activeId).toBe("co_2");
    expect(ipcMock.settings.update).toHaveBeenCalledWith({ activeCompanyId: "co_2" });
  });
});
```

- [ ] **Step 5.2: Run the test to confirm it fails**

```bash
pnpm --filter @dashboard-agent/renderer test -- companies
```

Expected: FAIL — module `./companies.js` doesn't exist.

- [ ] **Step 5.3: Implement the store**

Create `apps/renderer/src/stores/companies.ts`:

```typescript
import { create } from "zustand";
import type { Company } from "@dashboard-agent/shared";

type State = {
  companies: Company[];
  activeId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string) => Promise<Company>;
  delete: (id: string) => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
};

export const useCompaniesStore = create<State>((set, get) => ({
  companies: [],
  activeId: null,
  loaded: false,

  load: async () => {
    const [companies, settings] = await Promise.all([
      window.dashboardAgent.companies.list(),
      window.dashboardAgent.settings.get(),
    ]);
    const persistedId = settings.activeCompanyId;
    const validPersisted =
      persistedId !== null && companies.some((c) => c.id === persistedId) ? persistedId : null;
    const activeId = validPersisted ?? companies[0]?.id ?? null;
    set({ companies, activeId, loaded: true });
  },

  create: async (name) => {
    const created = await window.dashboardAgent.companies.create(name);
    set((s) => ({ companies: [...s.companies, created] }));
    await get().setActive(created.id);
    return created;
  },

  delete: async (id) => {
    await window.dashboardAgent.companies.delete(id);
    const remaining = get().companies.filter((c) => c.id !== id);
    const wasActive = get().activeId === id;
    const nextActive = wasActive ? (remaining[0]?.id ?? null) : get().activeId;
    set({ companies: remaining });
    if (wasActive) await get().setActive(nextActive);
  },

  setActive: async (id) => {
    await window.dashboardAgent.settings.update({ activeCompanyId: id });
    set({ activeId: id });
  },
}));
```

- [ ] **Step 5.4: Run the test to confirm it passes**

```bash
pnpm --filter @dashboard-agent/renderer test -- companies
```

Expected: PASS — all 7 assertions green.

- [ ] **Step 5.5: Commit**

```bash
git add apps/renderer/src/stores/companies.ts apps/renderer/src/stores/companies.test.ts
git commit -m "feat(m9): renderer companies store with activeId persisted via settings"
```

---

## Task 6: CompanySwitcher component (sidebar dropdown)

**Files:**
- Create: `apps/renderer/src/components/CompanySwitcher.tsx`

- [ ] **Step 6.1: Implement the dropdown**

Create `apps/renderer/src/components/CompanySwitcher.tsx`:

```tsx
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../stores/companies.js";
import { CreateCompanyModal } from "./CreateCompanyModal.js";
import { DeleteCompanyConfirm } from "./DeleteCompanyConfirm.js";

export const CompanySwitcher = () => {
  const { t } = useTranslation();
  const companies = useCompaniesStore((s) => s.companies);
  const activeId = useCompaniesStore((s) => s.activeId);
  const setActive = useCompaniesStore((s) => s.setActive);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = companies.find((c) => c.id === activeId) ?? null;

  if (companies.length === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full px-2 py-1.5 text-xs font-semibold text-brand bg-brand-bg rounded hover:bg-brand-bg/80 border border-brand/20"
        >
          + {t("company.switcher.createFirst")}
        </button>
        {showCreate && <CreateCompanyModal onClose={() => setShowCreate(false)} />}
      </>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2 py-1.5 text-xs font-semibold text-ink rounded hover:bg-surface-soft flex items-center justify-between gap-2 border border-surface-border"
      >
        <span className="truncate">{active?.name ?? t("company.switcher.placeholder")}</span>
        <span className="text-ink-soft">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 z-10 bg-surface border border-surface-border rounded shadow-lg overflow-hidden">
          {companies.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between px-2 py-1.5 text-xs ${
                c.id === activeId ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  void setActive(c.id);
                  setOpen(false);
                }}
                className="flex-1 text-left truncate"
              >
                {c.name}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingDeleteId(c.id);
                  setOpen(false);
                }}
                aria-label={t("company.switcher.deleteAria", { name: c.name })}
                className="ml-2 text-ink-soft hover:text-semantic-danger"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setOpen(false);
            }}
            className="w-full text-left px-2 py-1.5 text-xs text-brand font-medium hover:bg-surface-soft border-t border-surface-border"
          >
            + {t("company.switcher.create")}
          </button>
        </div>
      )}
      {showCreate && <CreateCompanyModal onClose={() => setShowCreate(false)} />}
      {pendingDeleteId !== null && (
        <DeleteCompanyConfirm
          companyId={pendingDeleteId}
          onClose={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 6.2: Typecheck**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
```

Expected: FAIL — `CreateCompanyModal` and `DeleteCompanyConfirm` don't exist yet. We'll create them in Tasks 7 + 8.

> **Note:** Don't commit yet — the two missing components will be added in the next tasks. Continue to Task 7.

---

## Task 7: CreateCompanyModal

**Files:**
- Create: `apps/renderer/src/components/CreateCompanyModal.tsx`

- [ ] **Step 7.1: Implement the modal**

Create `apps/renderer/src/components/CreateCompanyModal.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../stores/companies.js";

type Props = { onClose: () => void };

export const CreateCompanyModal = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const create = useCompaniesStore((s) => s.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(t("company.create.errorEmpty"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await create(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">{t("company.create.title")}</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("company.create.namePlaceholder")}
          autoFocus
          disabled={busy}
          className="w-full px-3 py-2 text-sm border border-surface-border rounded bg-surface-soft focus:outline-none focus:border-brand"
        />
        {error !== null && (
          <p className="mt-2 text-xs text-semantic-danger">{error}</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-soft rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
          >
            {busy ? t("company.create.submitting") : t("company.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 7.2: Typecheck**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
```

Expected: still failing on `DeleteCompanyConfirm` (next task). Continue.

---

## Task 8: DeleteCompanyConfirm

**Files:**
- Create: `apps/renderer/src/components/DeleteCompanyConfirm.tsx`

- [ ] **Step 8.1: Implement the modal**

Create `apps/renderer/src/components/DeleteCompanyConfirm.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../stores/companies.js";
import { useAgentsStore } from "../stores/agents.js";
import { useIssuesStore } from "../stores/issues.js";
import { useProjectsStore } from "../stores/projects.js";

type Props = { companyId: string; onClose: () => void };

export const DeleteCompanyConfirm = ({ companyId, onClose }: Props) => {
  const { t } = useTranslation();
  const companies = useCompaniesStore((s) => s.companies);
  const deleteFn = useCompaniesStore((s) => s.delete);
  const agents = useAgentsStore((s) => s.agents);
  const issues = useIssuesStore((s) => s.issues);
  const projects = useProjectsStore((s) => s.projects);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = companies.find((c) => c.id === companyId);
  const isLastCompany = companies.length === 1;

  // Counts are only accurate when the company being deleted is the active one
  // (stores hold data for the active company). For non-active companies the
  // counts default to 0; that's fine — the warning still tells the user the
  // cascade happens.
  const isActive = useCompaniesStore.getState().activeId === companyId;
  const agentCount = isActive ? agents.length : 0;
  const issueCount = isActive ? issues.length : 0;
  const projectCount = isActive ? projects.length : 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteFn(companyId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (target === undefined) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-2 text-semantic-danger">
          {t("company.delete.title")}
        </h2>
        <p className="text-sm text-ink mb-2">
          {t("company.delete.body", { name: target.name })}
        </p>
        {isActive && (agentCount > 0 || issueCount > 0 || projectCount > 0) && (
          <p className="text-xs text-ink-muted mb-2">
            {t("company.delete.cascadeCounts", {
              agents: agentCount,
              issues: issueCount,
              projects: projectCount,
            })}
          </p>
        )}
        {!isActive && (
          <p className="text-xs text-ink-muted mb-2">
            {t("company.delete.cascadeWarning")}
          </p>
        )}
        {isLastCompany && (
          <p className="text-xs text-semantic-warning mb-2">
            {t("company.delete.lastWarning")}
          </p>
        )}
        {error !== null && (
          <p className="mt-2 text-xs text-semantic-danger">{error}</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-soft rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-semantic-danger text-white rounded disabled:opacity-50"
          >
            {busy ? t("company.delete.deleting") : t("company.delete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 8.2: Typecheck**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
```

Expected: PASS — all 3 new components compile.

- [ ] **Step 8.3: Commit the 3 components together**

```bash
git add apps/renderer/src/components/CompanySwitcher.tsx apps/renderer/src/components/CreateCompanyModal.tsx apps/renderer/src/components/DeleteCompanyConfirm.tsx
git commit -m "feat(m9): company switcher dropdown + create + delete modals"
```

---

## Task 9: Wire CompanySwitcher into Sidebar + App.tsx refactor

**Files:**
- Modify: `apps/renderer/src/App.tsx`

- [ ] **Step 9.1: Replace companies[0]! with store**

Edit `apps/renderer/src/App.tsx`. Add imports near the existing store imports (around lines 5-10):

```typescript
import { useCompaniesStore } from "./stores/companies.js";
import { CompanySwitcher } from "./components/CompanySwitcher.js";
```

In the `Sidebar` component, after `<h1 className="px-2 mb-4 …">{t("app.title")}</h1>` (around line 47), insert:

```tsx
<div className="px-2 mb-3">
  <CompanySwitcher />
</div>
```

In the `App` component, replace the existing `useEffect` block that loads agents/inbox (around lines 219-231) with the following — it now reacts to `activeId` from the store:

```typescript
const loadCompanies = useCompaniesStore((s) => s.load);
const activeCompanyId = useCompaniesStore((s) => s.activeId);

// Initial companies load triggers everything else.
useEffect(() => {
  if (!hasToken) return;
  void loadCompanies();
}, [hasToken, loadCompanies]);

// React to active company changes — load the per-company stores.
useEffect(() => {
  if (!hasToken || activeCompanyId === null) return;
  void (async () => {
    await loadAgents(activeCompanyId);
    await loadInbox(activeCompanyId);
    await useProjectsStore.getState().load(activeCompanyId);
    await useIssuesStore.getState().load(activeCompanyId);
  })();
}, [hasToken, activeCompanyId, loadAgents, loadInbox]);
```

Then replace the inbox subscription block (around lines 236-247) so it uses the store-derived active id:

```typescript
useEffect(() => {
  if (!hasToken) return;
  const off = window.dashboardAgent.inbox.onUpdate(() => {
    const cid = useCompaniesStore.getState().activeId;
    if (cid !== null) void loadInbox(cid);
  });
  return off;
}, [hasToken, loadInbox]);
```

And in the `roster-changed` branch of the `agent:event` handler (around line 269), change:

```typescript
case "roster-changed":
  void loadAgents(ev.companyId);
  break;
```

to leave the call as-is — it already takes `ev.companyId` from the event payload, no change needed. Just verify it still does the right thing when multiple companies exist (broadcast still scoped to one company).

- [ ] **Step 9.2: Typecheck + run all renderer tests**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
pnpm --filter @dashboard-agent/renderer test
```

Expected: typecheck clean. All existing tests pass (companies store test, agents/inbox/budgets/goals tests untouched).

- [ ] **Step 9.3: Commit**

```bash
git add apps/renderer/src/App.tsx
git commit -m "feat(m9): wire company switcher into sidebar + reactive active-company effects"
```

---

## Task 10: Dashboard.tsx use store

**Files:**
- Modify: `apps/renderer/src/routes/Dashboard.tsx`

- [ ] **Step 10.1: Replace local companyId state with store selector**

Edit `apps/renderer/src/routes/Dashboard.tsx`. Replace the whole file:

```tsx
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { useCompaniesStore } from "../stores/companies.js";
import { CostsTodayWidget } from "../components/costs/CostsTodayWidget.js";

export const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const loadAgents = useAgentsStore((s) => s.load);
  const companyId = useCompaniesStore((s) => s.activeId);

  const onCreateDemo = async () => {
    const company = await window.dashboardAgent.companies.createDemo();
    await useCompaniesStore.getState().load();
    await useCompaniesStore.getState().setActive(company.id);
    await loadAgents(company.id);
    const updated = useAgentsStore.getState().agents;
    if (updated.length > 0) navigate(`/agents/${updated[0]!.id}`);
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">{t("app.title")}</h1>
        <p className="text-ink-muted mt-2">{t("dashboard.placeholder")}</p>
      </div>
      {companyId !== null && <CostsTodayWidget companyId={companyId} />}
      {agents.length === 0 && (
        <button
          onClick={() => void onCreateDemo()}
          className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded"
          type="button"
        >
          {t("dashboard.createDemoCompany")}
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 10.2: Typecheck**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
```

Expected: clean.

- [ ] **Step 10.3: Commit**

```bash
git add apps/renderer/src/routes/Dashboard.tsx
git commit -m "feat(m9): dashboard reads activeId from companies store"
```

---

## Task 11: i18n keys + parity test

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 11.1: Add PT-BR keys**

Edit `apps/renderer/src/i18n/pt-BR.json`. Add (find the existing `company` block or insert at the top level, alphabetical position):

```json
"company": {
  "switcher": {
    "placeholder": "Selecionar empresa…",
    "create": "Nova empresa",
    "createFirst": "Criar primeira empresa",
    "deleteAria": "Deletar {{name}}"
  },
  "create": {
    "title": "Nova empresa",
    "namePlaceholder": "Nome da empresa",
    "submit": "Criar",
    "submitting": "Criando…",
    "errorEmpty": "Nome é obrigatório"
  },
  "delete": {
    "title": "Deletar empresa",
    "body": "Deletar \"{{name}}\" remove todos os agentes, issues, projects e histórico associados. Esta ação não pode ser desfeita.",
    "cascadeCounts": "{{agents}} agente(s), {{issues}} issue(s), {{projects}} project(s) serão deletados.",
    "cascadeWarning": "Todos os dados da empresa (agentes, issues, projects, threads) serão deletados em cascata.",
    "lastWarning": "Esta é a única empresa — você ficará sem empresas após deletar.",
    "confirm": "Deletar",
    "deleting": "Deletando…"
  }
}
```

If the file already has a `common` block with `cancel`, leave it. Otherwise add:

```json
"common": {
  "cancel": "Cancelar"
}
```

- [ ] **Step 11.2: Add EN-US keys**

Edit `apps/renderer/src/i18n/en-US.json`. Add the mirror:

```json
"company": {
  "switcher": {
    "placeholder": "Select company…",
    "create": "New company",
    "createFirst": "Create first company",
    "deleteAria": "Delete {{name}}"
  },
  "create": {
    "title": "New company",
    "namePlaceholder": "Company name",
    "submit": "Create",
    "submitting": "Creating…",
    "errorEmpty": "Name is required"
  },
  "delete": {
    "title": "Delete company",
    "body": "Deleting \"{{name}}\" removes all associated agents, issues, projects and history. This action cannot be undone.",
    "cascadeCounts": "{{agents}} agent(s), {{issues}} issue(s), {{projects}} project(s) will be deleted.",
    "cascadeWarning": "All company data (agents, issues, projects, threads) will be cascade-deleted.",
    "lastWarning": "This is your only company — you'll have no companies after deletion.",
    "confirm": "Delete",
    "deleting": "Deleting…"
  }
}
```

If needed:

```json
"common": {
  "cancel": "Cancel"
}
```

- [ ] **Step 11.3: Run parity test**

```bash
pnpm --filter @dashboard-agent/renderer test -- parity
```

Expected: PASS — the existing parity test walks both JSON trees and asserts every key in PT-BR has an EN-US counterpart and vice versa. If it doesn't already do this, add an assertion that the new `company.*` keys exist in both files.

> **If the parity test is more loose (just checks a fixed key list):** find where the new keys should be added to the assertion list and add them. The exact shape depends on what the test does — read it before editing.

- [ ] **Step 11.4: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m9): i18n keys for company switcher + modals (pt-BR + en-US)"
```

---

## Task 12: Full suite verification

- [ ] **Step 12.1: Run all tests**

```bash
pnpm -r test
```

Expected: all pass. Suite should be **711 + ~10 new = ~721 passing**. If any test that previously passed now fails, investigate before continuing — this PR may have leaked an assumption.

- [ ] **Step 12.2: Typecheck all packages**

```bash
pnpm -r typecheck
```

Expected: clean across `main`, `renderer`, `shared`.

- [ ] **Step 12.3: Lint all packages**

```bash
pnpm -r lint
```

Expected: clean.

- [ ] **Step 12.4: Build**

```bash
pnpm -r build
```

Expected: clean. Verifies the preload bundle still compiles (preload uses CJS isolation per `project_m7_6_lessons.md` — make sure no shared/zod import leaked into preload through env.d.ts changes).

---

## Task 13: Roadmap update (3 places)

**Files:**
- Modify: `ROADMAP.md`
- Modify: `apps/renderer/public/docs/roadmap.html`

> See [[feedback_roadmap_3_lugares]] memory for the established pattern.

- [ ] **Step 13.1: ROADMAP.md updates**

Edit `ROADMAP.md`. In §M9 (around line 724), check off the items completed by PR-A:

```diff
- [ ] **Multi-empresa:**
-   - [ ] Dropdown topo da sidebar pra trocar de company
-   - [ ] Criar nova empresa (modal com nome)
-   - [ ] Deletar empresa (confirm + cascade DELETE)
-   - [ ] Active company persistido em settings
+ - [x] **Multi-empresa:** ✅ PR-A 2026-05-14 — store + sidebar dropdown + create/delete modals + active company em settings
+   - [x] Dropdown topo da sidebar pra trocar de company
+   - [x] Criar nova empresa (modal com nome)
+   - [x] Deletar empresa (confirm + cascade DELETE)
+   - [x] Active company persistido em settings
```

In the "Em linguagem simples" section (around line 113), update the multi-empresa bullet:

```diff
- 🏢 **Trocar entre empresas via dropdown da sidebar** → M9
+ 🏢 **Trocar entre empresas via dropdown da sidebar** ✅ M9 PR-A
```

In the "v1 scope tracker" / "Multi-empresa" row (~line 192):

```diff
- | **Multi-empresa** | 🟡 Parcial | Backend pronto (...). UI: dropdown topo da sidebar pra trocar entre empresas **AINDA NÃO** (M9). ... |
+ | **Multi-empresa** | ✅ Completo | M9 PR-A entregou switcher + create/delete modals + active company persistido em settings (2026-05-14). |
```

- [ ] **Step 13.2: roadmap.html updates**

Edit `apps/renderer/public/docs/roadmap.html`. Three sections:

1. **/00 layperson** — find the section that explains the app for non-technical readers; update the "trocar entre empresas" mention to past tense.
2. **/01 progress** — bump the progress counter (M9 now has PR-A done; might be expressed as 14.something out of 14, or fraction).
3. **/03 módulos** — in the M9 article, add a new sub-article or note "PR-A multi-empresa merged 2026-05-14".

(Exact edits depend on the html structure — read the file first to find the right anchors. Pattern is established by M8.5 / M8.6 closure commits.)

- [ ] **Step 13.3: Commit roadmap**

```bash
git add ROADMAP.md apps/renderer/public/docs/roadmap.html
git commit -m "docs(m9): close pr-a multi-empresa in roadmap (3 places)"
```

---

## Task 14: Smoke test summary + memory snippet

- [ ] **Step 14.1: Manual smoke (optional but recommended)**

```bash
pnpm dev
```

In the app:
1. Verify sidebar shows company switcher dropdown (or "Criar primeira empresa" CTA if zero).
2. Create a second company via the dropdown → switch to it → verify Dashboard re-loads with the new context (agents list empty for the new company).
3. Switch back to the first company → verify Dashboard re-shows previous data.
4. Delete the second company → confirm modal warns about cascade → confirm → verify it's gone from dropdown and active falls back to the first.
5. Restart the app → verify active company persisted (still on the first).

> **If anything broken:** do NOT mark this PR done. File an issue or fix inline.

- [ ] **Step 14.2: Add lessons memory**

Create `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_m9_pr_a_lessons.md` with shape:

```markdown
---
name: project-m9-pr-a-lessons
description: "M9 PR-A multi-empresa lessons — store + dropdown + modals + active company. Mergeado 2026-05-14. ~10 testes novos. Lições: settings.activeCompanyId é JSON-only (sem DDL), zustand getState() dentro de actions pra cross-store updates, FK cascade já existia de M1."
metadata:
  type: project
---

# M9 PR-A — Multi-empresa core (mergeado 2026-05-14)

## Decisões
- `activeCompanyId` foi pra `AppSettings` (JSON blob) — sem nova migration.
- `setActive` é apenas `settings.update({ activeCompanyId })` — não há IPC dedicado.
- Cascade DELETE já estava em `0001_initial.sql` (`agents.company_id REFERENCES … ON DELETE CASCADE`).

## Lições
1. **Zustand actions com cross-store needs**: usar `useCompaniesStore.getState()` em vez de prop-drilling — pattern já existe em `projects.ts`.
2. **App.tsx useEffect chain**: separar "load companies" do "react ao activeId muda" — dois useEffects encadeados (initial + reactive).
3. **Sidebar inline em App.tsx**: não extrair pra arquivo próprio agora — refactor virou parte do scope só ao adicionar switcher. CompanySwitcher.tsx fica solto.

## Próximo
PR-D — API key adapter (`claude-api-key-local`). Spec §5.
```

Then add a line to `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\MEMORY.md`:

```markdown
- [M9 PR-A lições — Multi-empresa core](project_m9_pr_a_lessons.md) — mergeado 2026-05-14 — settings.activeCompanyId JSON-only, FK cascade já existia, zustand getState() em cross-store actions
```

- [ ] **Step 14.3: Final commit (memory update lives outside repo, no git commit needed)**

The PR is done. Verify `git status` is clean and the suite is green.

```bash
git status
git log --oneline -10
```

Expected: ~10 new commits, working tree clean, branch master (or feature branch if you chose to fork).

---

## Self-review checklist

- [x] **Spec coverage:** every bullet in spec §4 (PR-A) is mapped to a task — store (T5), switcher (T6), create modal (T7), delete confirm (T8), App.tsx refactor (T9), Dashboard (T10), i18n (T11), edge cases (covered in T5 store tests).
- [x] **Placeholder scan:** every step has actual code or commands. No "TBD" / "TODO" / "similar to above".
- [x] **Type consistency:** `Company` type unchanged. `useCompaniesStore` State shape matches the test mock shape. `companies.create(name: string)` consistent across preload + env.d.ts + store.
- [x] **Migration:** no DDL — settings is JSON blob, schema lives in `apps/main/src/settings/schema.ts` (zod, not shared).

If during execution you find something this plan got wrong, fix inline and add a note to the lessons memory in T14.
