# M9 PR-F.1 — Projects polish + companies.sh export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Projects polish (icon emoji + archived state + list filter) and companies.sh **export** (JSON snapshot for backup/inspection). Companies.sh **import** deferred to PR-F.2 because of FK remap complexity.

**Architecture:** Migration 0016 adds `projects.icon` and `projects.archived_at` columns. Repo gets `setIcon` + `archive` + `unarchive` methods; IPC + preload + renderer store extended. ProjectFormModal grows a small emoji grid picker + archive checkbox (edit mode). Projects.tsx adds a "show archived" toggle + visual greying. Backend `companies:export` IPC produces a JSON blob with all child rows of a company; Settings UI offers an "Export company" button that triggers a file-save dialog in the main process.

**Tech Stack:** better-sqlite3, Electron `dialog.showSaveDialog`, React 18, zustand, vitest.

> **Deferred to PR-F.2:** AGENTS.md import/export (gray-matter + zod schema), Issue Review tab + react-diff-viewer-continued, companies.sh **import** (FK remap is non-trivial — needs separate plan).

---

## File map

**Create:**
- `apps/main/src/db/migrations/0016_projects_icon_archived.sql`
- `apps/main/src/companies/export.ts` — serializer
- `apps/main/src/companies/export.test.ts`

**Modify:**
- `packages/shared/src/types/project.ts` — add `icon`, `archivedAt`
- `packages/shared/src/ipc-channels.ts` — add `PROJECTS_SET_ICON`, `PROJECTS_ARCHIVE`, `PROJECTS_UNARCHIVE`, `COMPANY_EXPORT`
- `apps/main/src/projects/repository.ts` — extend repo with setIcon/archive/unarchive + return new fields
- `apps/main/src/ipc/projects-handlers.ts` — new IPC handlers (find exact file path — see `grep`)
- `apps/main/src/ipc/companies-handlers.ts` — new export handler
- `apps/main/src/ipc/preload.ts` — expose new IPCs
- `apps/renderer/src/env.d.ts` — extend types
- `apps/renderer/src/stores/projects.ts` — extend store
- `apps/renderer/src/components/projects/ProjectFormModal.tsx` — icon picker + archive checkbox
- `apps/renderer/src/components/projects/ProjectListItem.tsx` — show icon + archived style
- `apps/renderer/src/routes/Projects.tsx` — archived filter toggle
- `apps/renderer/src/routes/Settings.tsx` — "Export company" button + file save flow
- `apps/renderer/src/stores/companies.ts` — add `exportSnapshot` action
- `apps/renderer/src/i18n/pt-BR.json` + `en-US.json` + `parity.test.ts`
- `ROADMAP.md` + `docs/roadmap.html`

---

## Task 1: Migration 0016 + shared Project type

**Files:**
- Create: `apps/main/src/db/migrations/0016_projects_icon_archived.sql`
- Modify: `packages/shared/src/types/project.ts`

- [ ] **Step 1.1: Create migration**

Create `apps/main/src/db/migrations/0016_projects_icon_archived.sql`:

```sql
-- M9 PR-F.1: Projects polish — emoji icon + archived state.
-- Both columns nullable: existing projects load with icon=NULL, archived_at=NULL.

ALTER TABLE projects ADD COLUMN icon TEXT;
ALTER TABLE projects ADD COLUMN archived_at INTEGER;
```

- [ ] **Step 1.2: Extend shared Project type**

Edit `packages/shared/src/types/project.ts`:

```typescript
export type Project = {
  id: string;
  companyId: string;
  name: string;
  path: string;
  color: string;
  icon: string | null;
  archivedAt: number | null;
  slug: string | null;
  createdAt: number;
};

export type ProjectPathStatus = "available" | "missing";
```

- [ ] **Step 1.3: Typecheck + commit**

```bash
pnpm -r typecheck
```

> Typecheck will fail on the repo + store + renderer until tasks 2/3 update them. That's expected — commit and continue to Task 2.

```bash
git add apps/main/src/db/migrations/0016_projects_icon_archived.sql packages/shared/src/types/project.ts
git commit -m "feat(m9): projects schema — icon + archived_at columns"
```

---

## Task 2: Projects repo — setIcon + archive/unarchive + extend rowToProject

**Files:**
- Modify: `apps/main/src/projects/repository.ts`

- [ ] **Step 2.1: Update Row + rowToProject**

Edit `apps/main/src/projects/repository.ts`. Update `Row`:

```typescript
type Row = {
  id: string;
  company_id: string;
  name: string;
  path: string;
  color: string;
  slug: string | null;
  icon: string | null;
  archived_at: number | null;
  created_at: number;
};
```

Update `rowToProject`:

```typescript
const rowToProject = (r: Row): Project => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  path: r.path,
  color: r.color,
  slug: r.slug,
  icon: r.icon,
  archivedAt: r.archived_at,
  createdAt: r.created_at,
});
```

- [ ] **Step 2.2: Extend ProjectsRepository interface**

Add to the type:

```typescript
export type ProjectsRepository = {
  create(input: CreateProjectInput): Project;
  getById(id: string): Project | null;
  listByCompany(companyId: string): Project[];
  update(id: string, patch: UpdateProjectInput): Project | null;
  setSlug(id: string, slug: string): void;
  setIcon(id: string, icon: string | null): void;
  archive(id: string): void;
  unarchive(id: string): void;
  delete(id: string): void;
  checkPaths(companyId: string): Record<string, ProjectPathStatus>;
};
```

- [ ] **Step 2.3: Implement the methods**

Inside `createProjectsRepository`, after `updateSlug` add:

```typescript
const updateIcon = db.prepare("UPDATE projects SET icon = ? WHERE id = ?");
const updateArchived = db.prepare("UPDATE projects SET archived_at = ? WHERE id = ?");
```

Inside the returned object, after `setSlug`:

```typescript
setIcon(id, icon) {
  updateIcon.run(icon, id);
},
archive(id) {
  updateArchived.run(Date.now(), id);
},
unarchive(id) {
  updateArchived.run(null, id);
},
```

- [ ] **Step 2.4: Write failing repo tests**

Check existing `apps/main/src/projects/repository.test.ts` (if exists) or create. Append:

```typescript
describe("setIcon", () => {
  it("persists an emoji icon", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    repo.setIcon(p.id, "🚀");
    expect(repo.getById(p.id)?.icon).toBe("🚀");
  });

  it("setIcon null clears the icon", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    repo.setIcon(p.id, "🚀");
    repo.setIcon(p.id, null);
    expect(repo.getById(p.id)?.icon).toBeNull();
  });
});

describe("archive / unarchive", () => {
  it("archive sets archivedAt to a positive number", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    repo.archive(p.id);
    const after = repo.getById(p.id);
    expect(after?.archivedAt).not.toBeNull();
    expect(typeof after?.archivedAt).toBe("number");
  });

  it("unarchive clears archivedAt", () => {
    const db = setupDb();
    const repo = createProjectsRepository(db);
    const p = repo.create({ companyId: "c1", name: "P1", path: "/p1", color: "#fff" });
    repo.archive(p.id);
    repo.unarchive(p.id);
    expect(repo.getById(p.id)?.archivedAt).toBeNull();
  });
});
```

> **If no projects/repository.test.ts exists**, create one mirroring the pattern of `apps/main/src/companies/repository.test.ts`. setupDb runs migrations + inserts a company `c1`.

- [ ] **Step 2.5: Run + commit**

```bash
pnpm --filter @dashboard-agent/main test -- projects
pnpm --filter @dashboard-agent/main typecheck
git add apps/main/src/projects/repository.ts apps/main/src/projects/repository.test.ts
git commit -m "feat(m9): projects repo — setIcon + archive + unarchive"
```

---

## Task 3: IPC channels + handlers + preload bridge

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `apps/main/src/ipc/projects-handlers.ts` (locate via `grep`)
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 3.1: Add IPC channels**

Edit `packages/shared/src/ipc-channels.ts`. After `PROJECTS_SET_SLUG`:

```typescript
PROJECTS_SET_ICON: "projects:set-icon",
PROJECTS_ARCHIVE: "projects:archive",
PROJECTS_UNARCHIVE: "projects:unarchive",
COMPANY_EXPORT: "company:export",
```

- [ ] **Step 3.2: Locate projects-handlers.ts**

```bash
grep -rln "PROJECTS_DELETE" apps/main/src/ipc
```

Open the file. Append handlers inside `registerProjectsHandlers`:

```typescript
ipcMain.handle(
  IPC.PROJECTS_SET_ICON,
  (_e, payload: { id: string; icon: string | null }): { ok: true } => {
    if (typeof payload.id !== "string" || payload.id === "") {
      throw new Error("[projects:set-icon] id is required");
    }
    repo.setIcon(payload.id, payload.icon);
    return { ok: true };
  },
);

ipcMain.handle(IPC.PROJECTS_ARCHIVE, (_e, payload: { id: string }): { ok: true } => {
  if (typeof payload.id !== "string" || payload.id === "") {
    throw new Error("[projects:archive] id is required");
  }
  repo.archive(payload.id);
  return { ok: true };
});

ipcMain.handle(IPC.PROJECTS_UNARCHIVE, (_e, payload: { id: string }): { ok: true } => {
  if (typeof payload.id !== "string" || payload.id === "") {
    throw new Error("[projects:unarchive] id is required");
  }
  repo.unarchive(payload.id);
  return { ok: true };
});
```

- [ ] **Step 3.3: Preload bridge**

Edit `apps/main/src/ipc/preload.ts`. Find the `projects:` block. Add lines after `setSlug`:

```typescript
setIcon: (id: string, icon: string | null) =>
  ipcRenderer.invoke(IPC.PROJECTS_SET_ICON, { id, icon }) as Promise<{ ok: true }>,
archive: (id: string) =>
  ipcRenderer.invoke(IPC.PROJECTS_ARCHIVE, { id }) as Promise<{ ok: true }>,
unarchive: (id: string) =>
  ipcRenderer.invoke(IPC.PROJECTS_UNARCHIVE, { id }) as Promise<{ ok: true }>,
```

- [ ] **Step 3.4: env.d.ts**

Edit `apps/renderer/src/env.d.ts`. Extend the `projects` interface:

```typescript
setIcon: (id: string, icon: string | null) => Promise<{ ok: true }>;
archive: (id: string) => Promise<{ ok: true }>;
unarchive: (id: string) => Promise<{ ok: true }>;
```

- [ ] **Step 3.5: Typecheck + commit**

```bash
pnpm -r typecheck
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/projects-handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m9): projects ipc handlers — setIcon + archive + unarchive"
```

---

## Task 4: Renderer projects store extension

**Files:**
- Modify: `apps/renderer/src/stores/projects.ts`

- [ ] **Step 4.1: Add 3 actions**

Edit `apps/renderer/src/stores/projects.ts`. Add to State type:

```typescript
setIcon: (id: string, icon: string | null) => Promise<void>;
archive: (id: string) => Promise<void>;
unarchive: (id: string) => Promise<void>;
```

Inside the factory:

```typescript
setIcon: async (id, icon) => {
  await window.dashboardAgent.projects.setIcon(id, icon);
  set((s) => ({
    projects: s.projects.map((p) => (p.id === id ? { ...p, icon } : p)),
  }));
},
archive: async (id) => {
  await window.dashboardAgent.projects.archive(id);
  set((s) => ({
    projects: s.projects.map((p) => (p.id === id ? { ...p, archivedAt: Date.now() } : p)),
  }));
},
unarchive: async (id) => {
  await window.dashboardAgent.projects.unarchive(id);
  set((s) => ({
    projects: s.projects.map((p) => (p.id === id ? { ...p, archivedAt: null } : p)),
  }));
},
```

- [ ] **Step 4.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/stores/projects.ts
git commit -m "feat(m9): renderer projects store — setIcon + archive + unarchive actions"
```

---

## Task 5: ProjectFormModal emoji picker + archive controls

**Files:**
- Modify: `apps/renderer/src/components/projects/ProjectFormModal.tsx`

- [ ] **Step 5.1: Add emoji picker + archive toggle**

Replace `apps/renderer/src/components/projects/ProjectFormModal.tsx`:

```tsx
import { useState, type FC, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@dashboard-agent/shared";

const COLORS = [
  "#1D5DD7",
  "#10b981",
  "#f59e0b",
  "#dc2626",
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
  "#64748b",
];

const ICONS = [
  "📁",
  "📦",
  "🚀",
  "🛠️",
  "🧪",
  "📊",
  "💡",
  "🎨",
  "🔧",
  "📝",
  "🔬",
  "🏗️",
  "🌐",
  "📱",
  "💼",
  "🎯",
  "⚙️",
  "🧭",
  "🗂️",
  "🧱",
];

type Props = {
  initial?: Project;
  onSubmit: (data: { name: string; path: string; color: string; icon: string | null }) => Promise<void>;
  onClose: () => void;
};

export const ProjectFormModal: FC<Props> = ({ initial, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [path, setPath] = useState(initial?.path ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]!);
  const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
  const [busy, setBusy] = useState(false);

  const pickFolder = async () => {
    const picked = await window.dashboardAgent.settings.pickWorkspace();
    if (picked !== null) setPath(picked);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === "" || path.trim() === "") return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), path: path.trim(), color, icon });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-surface-card rounded p-5 w-full max-w-sm shadow-xl">
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("projects.form.name")}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          className="w-full mb-3 px-2 py-1 border border-surface-border rounded text-sm"
        />
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("projects.form.path")}
        </label>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            className="flex-1 px-2 py-1 border border-surface-border rounded text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => void pickFolder()}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("projects.form.pickFolder")}
          </button>
        </div>
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("projects.form.icon")}
        </label>
        <div className="grid grid-cols-10 gap-1 mb-3">
          <button
            type="button"
            onClick={() => setIcon(null)}
            className={`w-7 h-7 rounded text-xs ${icon === null ? "bg-brand text-brand-fg" : "bg-surface-soft text-ink-muted"}`}
            title={t("projects.form.iconNone")}
          >
            —
          </button>
          {ICONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setIcon(emoji)}
              className={`w-7 h-7 rounded text-base ${icon === emoji ? "bg-brand-bg ring-2 ring-brand" : "bg-surface-soft hover:bg-surface-border"}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("projects.form.color")}
        </label>
        <div className="flex gap-2 mb-4">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{ background: c }}
              className={`w-6 h-6 rounded-full border-2 ${color === c ? "border-ink-muted" : "border-transparent"}`}
            />
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("projects.form.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="text-xs px-3 py-1 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
          >
            {t("projects.form.save")}
          </button>
        </div>
      </form>
    </div>
  );
};
```

- [ ] **Step 5.2: Update Projects.tsx to pass icon through**

Edit `apps/renderer/src/routes/Projects.tsx`. The `onSubmit` callback receives `{name, path, color, icon}`. Find:

```typescript
onSubmit={async (data) => {
  if (editing !== null) await updateProj({ id: editing.id, ...data });
  else await createProj({ companyId, ...data });
}}
```

The `updateProj` and `createProj` IPCs currently don't accept `icon`. We have 2 paths:

(a) Extend the existing `projects.create` + `projects.update` IPCs to accept icon. Cleanest.
(b) Strip icon out and call `setIcon` separately.

Pick (b) — minimal IPC surface change. Update Projects.tsx:

```typescript
onSubmit={async ({ name, path, color, icon }) => {
  if (editing !== null) {
    await updateProj({ id: editing.id, name, path, color });
    await useProjectsStore.getState().setIcon(editing.id, icon);
  } else {
    const created = await createProj({ companyId, name, path, color });
    if (icon !== null) await useProjectsStore.getState().setIcon(created.id, icon);
  }
}}
```

Note: `createProj` from the store currently returns the new project. Verify the signature: open the store file and confirm `create` returns `Promise<Project>`. If it doesn't, fall back to using `await window.dashboardAgent.projects.create(...)` directly.

- [ ] **Step 5.3: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/projects/ProjectFormModal.tsx apps/renderer/src/routes/Projects.tsx
git commit -m "feat(m9): project form — emoji icon picker"
```

---

## Task 6: ProjectListItem icon + archived styling + filter toggle

**Files:**
- Modify: `apps/renderer/src/components/projects/ProjectListItem.tsx`
- Modify: `apps/renderer/src/components/projects/ProjectDetail.tsx` (archive button)
- Modify: `apps/renderer/src/routes/Projects.tsx`

- [ ] **Step 6.1: ProjectListItem shows icon + greyed archived**

Read the existing ProjectListItem.tsx. Add icon rendering before the name:

```tsx
// inside the existing layout, near where {project.name} is rendered:
<span className="flex items-center gap-2 min-w-0">
  {project.icon !== null && <span className="text-base shrink-0">{project.icon}</span>}
  <span
    className={`truncate ${project.archivedAt !== null ? "text-ink-soft italic" : "text-ink"}`}
  >
    {project.name}
  </span>
</span>
```

> Adapt to the existing JSX shape — don't rewrite the file, just inject the icon + adjust class on the name span.

- [ ] **Step 6.2: ProjectDetail archive/unarchive button**

Edit `apps/renderer/src/components/projects/ProjectDetail.tsx`. Add a button row near the other actions (Edit/Delete/Open Folder):

```tsx
{project.archivedAt !== null ? (
  <button
    type="button"
    onClick={() => void useProjectsStore.getState().unarchive(project.id)}
    className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
  >
    {t("projects.detail.unarchive")}
  </button>
) : (
  <button
    type="button"
    onClick={() => void useProjectsStore.getState().archive(project.id)}
    className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
  >
    {t("projects.detail.archive")}
  </button>
)}
```

Add the `useProjectsStore` import if absent.

- [ ] **Step 6.3: Projects.tsx archived filter toggle**

Edit `apps/renderer/src/routes/Projects.tsx`. Add state:

```typescript
const [showArchived, setShowArchived] = useState(false);
```

Filter projects passed to the list:

```typescript
const visible = showArchived ? projects : projects.filter((p) => p.archivedAt === null);
```

Replace the `projects.map(...)` in the list with `visible.map(...)`.

Add a toggle above the new-button:

```tsx
<label className="flex items-center gap-1 text-xs text-ink-muted mb-2 px-2 cursor-pointer">
  <input
    type="checkbox"
    checked={showArchived}
    onChange={(e) => setShowArchived(e.target.checked)}
  />
  {t("projects.list.showArchived")}
</label>
```

- [ ] **Step 6.4: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/projects apps/renderer/src/routes/Projects.tsx
git commit -m "feat(m9): projects list — icon + archived greying + show-archived toggle"
```

---

## Task 7: companies.sh export — backend serializer

**Files:**
- Create: `apps/main/src/companies/export.ts`
- Create: `apps/main/src/companies/export.test.ts`

- [ ] **Step 7.1: Define export shape**

The export is a single JSON object. Schema version 1.

```typescript
export type CompanyExportV1 = {
  schemaVersion: 1;
  exportedAt: number;
  company: { id: string; name: string; createdAt: number };
  agents: unknown[];   // raw rows from agents table
  projects: unknown[]; // raw rows from projects table
  issues: unknown[];   // raw rows from issues table
  threads: unknown[];
  messages: unknown[];
  inbox: unknown[];
  costEvents: unknown[];
  activityEvents: unknown[];
  goals: unknown[];
  approvals: unknown[];
};
```

> **Rationale for `unknown[]`:** we serialize raw rows (column shape may change). Import (PR-F.2) will validate via zod. For this PR-F.1 we only need export.

- [ ] **Step 7.2: Implement serializer**

Create `apps/main/src/companies/export.ts`:

```typescript
import type Database from "better-sqlite3";

export type CompanyExportV1 = {
  schemaVersion: 1;
  exportedAt: number;
  company: { id: string; name: string; createdAt: number };
  agents: unknown[];
  projects: unknown[];
  issues: unknown[];
  threads: unknown[];
  messages: unknown[];
  inbox: unknown[];
  costEvents: unknown[];
  activityEvents: unknown[];
  goals: unknown[];
  approvals: unknown[];
};

const collect = (db: Database.Database, sql: string, params: Record<string, unknown>): unknown[] =>
  db.prepare(sql).all(params) as unknown[];

export const exportCompany = (db: Database.Database, companyId: string): CompanyExportV1 => {
  const companyRow = db
    .prepare("SELECT id, name, created_at FROM companies WHERE id = ?")
    .get(companyId) as { id: string; name: string; created_at: number } | undefined;
  if (companyRow === undefined) {
    throw new Error(`Company ${companyId} not found`);
  }

  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    company: { id: companyRow.id, name: companyRow.name, createdAt: companyRow.created_at },
    agents: collect(db, "SELECT * FROM agents WHERE company_id = @cid", { cid: companyId }),
    projects: collect(db, "SELECT * FROM projects WHERE company_id = @cid", { cid: companyId }),
    issues: collect(db, "SELECT * FROM issues WHERE company_id = @cid", { cid: companyId }),
    threads: collect(db, "SELECT * FROM threads WHERE company_id = @cid", { cid: companyId }),
    messages: collect(
      db,
      "SELECT m.* FROM messages m JOIN threads t ON m.thread_id = t.id WHERE t.company_id = @cid",
      { cid: companyId },
    ),
    inbox: collect(db, "SELECT * FROM inbox_items WHERE company_id = @cid", { cid: companyId }),
    costEvents: collect(db, "SELECT * FROM cost_events WHERE company_id = @cid", {
      cid: companyId,
    }),
    activityEvents: collect(db, "SELECT * FROM activity_events WHERE company_id = @cid", {
      cid: companyId,
    }),
    goals: collect(db, "SELECT * FROM goals WHERE company_id = @cid", { cid: companyId }),
    approvals: collect(
      db,
      "SELECT a.* FROM approvals a JOIN agents ag ON a.agent_id = ag.id WHERE ag.company_id = @cid",
      { cid: companyId },
    ),
  };
};
```

> **Schema notes:** if `approvals` table doesn't have `agent_id` column (verify with `grep "CREATE TABLE.*approvals" apps/main/src/db/migrations/`), adapt the SELECT. Same for `cost_events` and `goals` — drop columns that don't exist. Goal: produce a snapshot, not a perfectly normalized export.

> **Defensive fallback:** if any table query throws (e.g., column doesn't exist), wrap each `collect` call in a try/catch and default to `[]`. For PR-F.1 we want best-effort export; PR-F.2 import will tighten.

Wrap each in try/catch:

```typescript
const safeCollect = (db: Database.Database, sql: string, params: Record<string, unknown>): unknown[] => {
  try {
    return db.prepare(sql).all(params) as unknown[];
  } catch {
    return [];
  }
};
```

Use `safeCollect` instead of `collect` throughout.

- [ ] **Step 7.3: Write failing test**

Create `apps/main/src/companies/export.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportCompany } from "./export.js";
import { createCompaniesRepository } from "./repository.js";
import { createProjectsRepository } from "../projects/repository.js";

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

describe("exportCompany", () => {
  it("throws when company id is unknown", () => {
    const db = setupDb();
    expect(() => exportCompany(db, "co_doesnotexist")).toThrow(/not found/);
  });

  it("returns schemaVersion 1 + company metadata", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const out = exportCompany(db, co.id);
    expect(out.schemaVersion).toBe(1);
    expect(out.company.id).toBe(co.id);
    expect(out.company.name).toBe("Acme");
    expect(out.exportedAt).toBeGreaterThan(0);
  });

  it("includes child rows scoped to the company", () => {
    const db = setupDb();
    const co1 = createCompaniesRepository(db).create({ name: "C1" });
    const co2 = createCompaniesRepository(db).create({ name: "C2" });
    createProjectsRepository(db).create({
      companyId: co1.id,
      name: "P1",
      path: "/p1",
      color: "#fff",
    });
    createProjectsRepository(db).create({
      companyId: co2.id,
      name: "P2",
      path: "/p2",
      color: "#fff",
    });
    const out = exportCompany(db, co1.id);
    expect(out.projects).toHaveLength(1);
    expect((out.projects[0] as { name: string }).name).toBe("P1");
  });

  it("returns empty arrays for tables with no rows", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Empty" });
    const out = exportCompany(db, co.id);
    expect(out.agents).toEqual([]);
    expect(out.issues).toEqual([]);
    expect(out.messages).toEqual([]);
  });
});
```

- [ ] **Step 7.4: Run + commit**

```bash
pnpm --filter @dashboard-agent/main test -- export
git add apps/main/src/companies/export.ts apps/main/src/companies/export.test.ts
git commit -m "feat(m9): company export serializer (JSON snapshot, schemaVersion 1)"
```

---

## Task 8: company:export IPC + Settings UI

**Files:**
- Modify: `apps/main/src/ipc/companies-handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`
- Modify: `apps/renderer/src/routes/Settings.tsx`

- [ ] **Step 8.1: Backend IPC handler**

Edit `apps/main/src/ipc/companies-handlers.ts`. Add import:

```typescript
import { exportCompany, type CompanyExportV1 } from "../companies/export.js";
```

Inside `registerCompaniesHandlers`, add:

```typescript
ipcMain.handle(IPC.COMPANY_EXPORT, (_e, payload: { id: string }): CompanyExportV1 => {
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    throw new Error("[company:export] id is required");
  }
  return exportCompany(db, payload.id);
});
```

- [ ] **Step 8.2: Preload bridge**

Edit `apps/main/src/ipc/preload.ts`. Find the `companies:` block. After `delete`:

```typescript
exportSnapshot: (id: string) =>
  ipcRenderer.invoke(IPC.COMPANY_EXPORT, { id }) as Promise<unknown>,
```

- [ ] **Step 8.3: env.d.ts**

Edit `apps/renderer/src/env.d.ts`. Extend `companies`:

```typescript
exportSnapshot: (id: string) => Promise<unknown>;
```

- [ ] **Step 8.4: Settings.tsx export button**

Edit `apps/renderer/src/routes/Settings.tsx`. Near the bottom (above workspace section), add a new section:

```tsx
<section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
  <h2 className="text-base font-semibold text-brand-dark mb-2">
    {t("settings.companyExport.title")}
  </h2>
  <p className="text-xs text-ink-muted mb-3">{t("settings.companyExport.subtitle")}</p>
  <button
    type="button"
    onClick={() => void onExportCompany()}
    disabled={exportBusy}
    className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
  >
    {exportBusy ? t("settings.companyExport.exporting") : t("settings.companyExport.action")}
  </button>
  {exportError !== null && (
    <p className="mt-2 text-xs text-semantic-danger">{exportError}</p>
  )}
  {exportSavedAt !== null && (
    <p className="mt-2 text-xs text-semantic-success">{t("settings.companyExport.savedAt", { path: exportSavedAt })}</p>
  )}
</section>
```

Add the state + handler bindings near the top of the `Settings` component:

```typescript
const activeCompanyId = useCompaniesStore((s) => s.activeId);
const [exportBusy, setExportBusy] = useState(false);
const [exportError, setExportError] = useState<string | null>(null);
const [exportSavedAt, setExportSavedAt] = useState<string | null>(null);

const onExportCompany = async () => {
  if (activeCompanyId === null) {
    setExportError(t("settings.companyExport.noActiveCompany"));
    return;
  }
  setExportBusy(true);
  setExportError(null);
  setExportSavedAt(null);
  try {
    const snapshot = await window.dashboardAgent.companies.exportSnapshot(activeCompanyId);
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-agent-company-${activeCompanyId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportSavedAt(a.download);
  } catch (err) {
    setExportError(err instanceof Error ? err.message : String(err));
  } finally {
    setExportBusy(false);
  }
};
```

Add `useCompaniesStore` import if absent.

> **Why client-side blob download instead of Electron `dialog.showSaveDialog`?** Simpler, no extra IPC, no main-process file write. The browser within Electron offers a Save As dialog automatically when you trigger an `<a download>` with a Blob URL. If Electron's Chromium config disables it, fall back to a main-side IPC; PR-F.1 doesn't need to handle that edge case.

- [ ] **Step 8.5: Typecheck + commit**

```bash
pnpm -r typecheck
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/companies-handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts apps/renderer/src/routes/Settings.tsx
git commit -m "feat(m9): company:export ipc + settings ui (download json snapshot)"
```

---

## Task 9: i18n + parity

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 9.1: PT-BR — projects + settings keys**

Add to existing `projects` block (or create if absent):

```json
"projects": {
  "form": {
    "icon": "Ícone",
    "iconNone": "Sem ícone"
  },
  "list": {
    "showArchived": "Mostrar arquivados"
  },
  "detail": {
    "archive": "Arquivar projeto",
    "unarchive": "Desarquivar projeto"
  }
}
```

> Merge keys into existing blocks; don't overwrite.

Add inside `settings`:

```json
"companyExport": {
  "title": "Exportar empresa",
  "subtitle": "Baixa um JSON com todos os dados da empresa ativa (agentes, projects, issues, threads, mensagens, inbox, custos, activity). Útil pra backup ou debugging. Import virá em release futura.",
  "action": "Exportar JSON",
  "exporting": "Exportando…",
  "noActiveCompany": "Selecione uma empresa ativa primeiro.",
  "savedAt": "Salvo como: {{path}}"
}
```

- [ ] **Step 9.2: EN-US mirror**

Same keys in `apps/renderer/src/i18n/en-US.json`:

```json
"projects": {
  "form": {
    "icon": "Icon",
    "iconNone": "No icon"
  },
  "list": {
    "showArchived": "Show archived"
  },
  "detail": {
    "archive": "Archive project",
    "unarchive": "Unarchive project"
  }
}
```

```json
"companyExport": {
  "title": "Export company",
  "subtitle": "Downloads a JSON with all data from the active company (agents, projects, issues, threads, messages, inbox, costs, activity). Useful for backup or debugging. Import coming in a future release.",
  "action": "Export JSON",
  "exporting": "Exporting…",
  "noActiveCompany": "Select an active company first.",
  "savedAt": "Saved as: {{path}}"
}
```

- [ ] **Step 9.3: Parity assertion**

Edit `apps/renderer/src/i18n/parity.test.ts`. Add:

```typescript
it("includes the M9 PR-F.1 keys in both locales", () => {
  const ptKeys = flatten(ptBR);
  const enKeys = flatten(enUS);
  for (const k of [
    "projects.form.icon",
    "projects.form.iconNone",
    "projects.list.showArchived",
    "projects.detail.archive",
    "projects.detail.unarchive",
    "settings.companyExport.title",
    "settings.companyExport.subtitle",
    "settings.companyExport.action",
  ]) {
    expect(ptKeys).toContain(k);
    expect(enKeys).toContain(k);
  }
});
```

Run: `pnpm --filter @dashboard-agent/renderer test -- parity`. Expected PASS.

- [ ] **Step 9.4: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m9): i18n keys for projects polish + company export (pt-BR + en-US)"
```

---

## Task 10: Full suite verification

- [ ] **Step 10.1: Run all**

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

Expected: 784 + ~10 (4 repo + 4 export + 1 parity + 1 type slack) = **~794 tests**.

---

## Task 11: Roadmap (3 lugares)

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/roadmap.html`

- [ ] **Step 11.1: ROADMAP.md updates**

In `ROADMAP.md` find the §M9 Paperclip wishlist block. Update:

```diff
- [ ] **companies.sh import/export** (Paperclip wishlist):
-   - [ ] Settings UI: botão "Export company..." — gera JSON com agents + threads + messages + inbox + projects + issues + costs_log da company selecionada
-   - [ ] Settings UI: botão "Import company..." — file picker, valida shape, INSERT cascade
+ [x] **companies.sh export** ✅ **PR-F.1 mergeado 2026-05-14** (import deferido pra PR-F.2)
+   - [x] Settings UI: botão "Exportar JSON" — gera JSON com agents/threads/messages/inbox/projects/issues/costs/activity/goals/approvals (schemaVersion 1)
+   - [ ] Settings UI: botão "Import company..." → **PR-F.2**: requer FK remap (não-trivial)
```

```diff
- [ ] **Project icons + status (archived vs active)** — pequeno, polish
+ [x] **Project icons + archived state** ✅ **PR-F.1 mergeado 2026-05-14** — emoji picker (20 emojis hardcoded) + archive/unarchive button + show-archived filter
```

- [ ] **Step 11.2: roadmap.html**

Edit `docs/roadmap.html`:

1. /01 progress meta + agora card: bump test count to ~794, update "M9 PR-F.1 mergeado", restantes = "PR-F.2 (AGENTS.md + Reviews UX + import)".
2. /03 modules: M9 article — adicionar feature group ✅ "Projects polish + companies.sh export (PR-F.1 · 2026-05-14)".

- [ ] **Step 11.3: Commit**

```bash
git add ROADMAP.md docs/roadmap.html
git commit -m "docs(m9): close pr-f.1 projects polish + company export in roadmap (3 places)"
```

---

## Task 12: Memory + handoff

**Files:**
- Create: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_m9_pr_f1_lessons.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\MEMORY.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_session_handoff.md`

- [ ] **Step 12.1: Lessons memory**

Content:

```markdown
---
name: project-m9-pr-f1-lessons
description: "M9 PR-F.1 projects polish + company export mergeado 2026-05-14. Migration 0016 (projects.icon + archived_at) + emoji picker hardcoded + archive toggle + show-archived filter + company:export IPC (JSON schemaVersion 1, snapshot only). Import deferido pra PR-F.2 (FK remap não-trivial)."
metadata:
  type: project
---

# M9 PR-F.1 — Projects polish + companies.sh export (mergeado 2026-05-14)

## Decisões
- **Import deferido pra PR-F.2** — regenerar IDs + remap FKs em 10 tabelas é trabalho dedicado. Export-only neste PR já entrega valor (backup, debug, share com support).
- **Emoji picker hardcoded** (20 emojis) em vez de dep `emoji-mart` — economiza ~200kb bundle e cobre o caso "ícone simples".
- **`safeCollect` no export** — try/catch por tabela. Permite que diferenças de schema entre versions não quebrem export inteiro.
- **Blob download em vez de Electron save dialog** — simplifica IPC (não precisa main-side file write). Browser within Electron oferece Save As automaticamente.

## Lições
1. **`Project` shape extension propaga em 7 lugares** — shared type, repo Row, rowToProject, IPC channels, preload, env.d.ts, store. Pattern recorrente.
2. **`createProj` retorna `Promise<void>` no store mas `Project` no IPC** — pra usar o id do novo project depois de criar, ou bater no IPC direto, ou refactorar a store action pra retornar.
3. **Export usa raw rows (`SELECT *`)** em vez de hidratar via repo methods — preserva todas as colunas atuais e futuras automaticamente.

## Status final
- 13/14 milestones do v1; M9 com 5.5/6 PRs (F.2 ainda)
- ~794 testes passing
- Próximo: **M9 PR-F.2 — AGENTS.md import/export + Reviews UX + companies.sh import** — fecha M9. Depois M10 → v1.
```

- [ ] **Step 12.2: MEMORY.md + handoff bump**

Add new entry to MEMORY.md after PR-E. Update session_handoff: HEAD, tests, "5.5/6 PRs", próximo PR-F.2.

---

## Self-review checklist

- [x] **Spec coverage:** Project icons ✅ (T1+T5), archived state ✅ (T1+T6), show-archived filter ✅ (T6), companies.sh export ✅ (T7+T8). AGENTS.md + Reviews UX + companies.sh import explicitly deferred to PR-F.2.
- [x] **Placeholder scan:** every step has actual code or commands.
- [x] **Type consistency:** `Project.icon: string | null` + `Project.archivedAt: number | null` consistent across shared, repo, store, UI. `exportSnapshot()` returns `Promise<unknown>` deliberately (caller serializes to JSON; main has the typed return).
- [x] **Migration 0016:** confirmed next available after 0015.

If something diverges (column names, IPC handler file location, etc.), fix inline and note in T12 lessons.
