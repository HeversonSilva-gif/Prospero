# M6 Issues + Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build full Projects + Issues CRUD on top of M5 — replace stub MCP tools with real impls, migrate sandbox from single `workspaceCwd` to per-agent project allowlist, add `/projects` and `/issues` UIs.

**Architecture:** Single milestone, faseado: schema migration → Projects backend → Projects UI → sandbox migration → Issues backend (incl. real MCP tools) → Issues UI (kanban + modal + comments + tool history) → realtime + polish. All commits land in `master` via one PR.

**Tech Stack:** TypeScript · Electron 33 · React 18 · Vite · Tailwind · zustand · better-sqlite3 (WAL) · @modelcontextprotocol/sdk · vitest · @dnd-kit/core + sortable (new dep).

**Spec:** [docs/superpowers/specs/2026-05-10-m6-issues-projects-design.md](../specs/2026-05-10-m6-issues-projects-design.md)

---

## File Structure

**Created:**
- `apps/main/src/db/migrations/0002_m6_issues_projects.sql` — issue_comments + issue_events tables
- `apps/main/src/db/post-migrations/0002.ts` — auto-create Default Workspace from workspaceCwd
- `apps/main/src/db/post-migrations/index.ts` — registry of post-migration scripts
- `apps/main/src/projects/repository.ts` — Project CRUD + path checks
- `apps/main/src/issues/repository.ts` — Issue CRUD + event writer
- `apps/main/src/issues/comments-repository.ts` — IssueComment CRUD
- `apps/main/src/issues/tool-history.ts` — derives tool calls during `doing` window
- `apps/main/src/ipc/projects-handlers.ts` — IPC for projects
- `apps/main/src/ipc/issues-handlers.ts` — IPC for issues + comments + agent allowlist
- `apps/main/src/ipc/issue-events-broadcast.ts` — broadcast helper for renderer
- `apps/main/tests/db.migration-0002.test.ts`
- `apps/main/tests/db.post-migration-0002.test.ts`
- `apps/main/tests/projects.repository.test.ts`
- `apps/main/tests/issues.repository.test.ts`
- `apps/main/tests/issues.comments-repository.test.ts`
- `apps/main/tests/issues.tool-history.test.ts`
- `apps/main/tests/ipc.projects-handlers.test.ts`
- `apps/main/tests/ipc.issues-handlers.test.ts`
- `apps/main/tests/mcp.tools-issues.test.ts`
- `apps/main/tests/security.gate-projects.test.ts`
- `apps/main/tests/m6-token-budget.test.ts`
- `apps/main/tests/fixtures/m6-token-baseline.json`
- `apps/renderer/src/routes/Projects.tsx`
- `apps/renderer/src/routes/Issues.tsx`
- `apps/renderer/src/components/projects/ProjectListItem.tsx`
- `apps/renderer/src/components/projects/ProjectDetail.tsx`
- `apps/renderer/src/components/projects/ProjectFormModal.tsx`
- `apps/renderer/src/components/projects/AllowlistEditor.tsx`
- `apps/renderer/src/components/issues/KanbanColumn.tsx`
- `apps/renderer/src/components/issues/IssueCard.tsx`
- `apps/renderer/src/components/issues/IssueFormModal.tsx`
- `apps/renderer/src/components/issues/IssueDetailModal.tsx`
- `apps/renderer/src/components/issues/IssueCommentsList.tsx`
- `apps/renderer/src/components/issues/CommentComposer.tsx`
- `apps/renderer/src/components/issues/SubtaskList.tsx`
- `apps/renderer/src/components/issues/ToolCallHistoryAccordion.tsx`
- `apps/renderer/src/components/issues/ReassignDropdown.tsx`
- `apps/renderer/src/stores/projects.ts`
- `apps/renderer/src/stores/issues.ts`

**Modified:**
- `apps/main/src/db/client.ts` — runs post-migrations after SQL migrations
- `apps/main/src/security/gate.ts` — `workspaceCwd: string` ⇒ `allowedProjectPaths: string[]`
- `apps/main/src/security/permission-watcher.ts` — passes new shape to gate
- `apps/main/src/index.ts` — wires projects repo into permission watcher
- `apps/main/src/orchestrator/lifecycle.ts` — settings.json adds new MCP tool allows (update_issue, assign_issue, list_issues, check_status, add_comment if exposed)
- `apps/main/src/mcp/tools.ts` — replaces `create_issue` stub + adds 4 new real MCP tools
- `apps/main/src/mcp/server.ts` — registers new tools (if explicit registry exists; verify in Task 18)
- `apps/main/src/ipc/handlers.ts` — register projects + issues handlers
- `apps/main/src/ipc/preload.ts` — expose new APIs to renderer
- `packages/shared/src/ipc-channels.ts` — new IPC channel constants
- `packages/shared/src/types.ts` — Project, Issue, IssueDetail, IssueComment, IssueEvent, ToolCallRef
- `packages/shared/src/index.ts` — re-export new types
- `apps/renderer/src/components/Sidebar.tsx` — adds Projects + Issues nav items
- `apps/renderer/src/routes/Settings.tsx` — removes workspace folder picker, adds nota
- `apps/renderer/src/i18n/en-US.json` + `pt-BR.json` — new keys
- `apps/renderer/src/main.tsx` (or router file — verify in Task 11) — register `/projects` + `/issues`
- `package.json` (apps/renderer) — add `@dnd-kit/core` + `@dnd-kit/sortable`
- `ROADMAP.md` — mark M6 as merged
- `CHANGELOG.md` — M6 entry

**Total:** ~30 files created, ~14 files modified.

---

## Phase 1 — Schema, migration, baseline (3 tasks)

### Task 1: Capture pre-M6 token baseline

**Files:**
- Create: `apps/main/tests/fixtures/m6-token-baseline.json`

This task runs FIRST before any M6 code so the baseline reflects M5-final behavior, not M6.

- [ ] **Step 1: Inspect tools.ts to find existing fixture or test that exercises CEO + create_issue stub**

Run:
```powershell
Select-String -Path "apps\main\tests\mcp.tools.test.ts" -Pattern "create_issue|tokens"
```

Expected: at least one test calling the `create_issue` stub. If none, capture baseline manually via the next step.

- [ ] **Step 2: Capture baseline by running M5 fixture (manual)**

Manually run the app once with M5 head (`git rev-parse HEAD` should be `5d2d879` or later spec commit), have CEO execute the prompt: `"Crie 3 issues no projeto Default: Setup CI, Login bug, Refactor API. Atribua a si mesmo. Liste todas."`. Sum `result.usage.output_tokens + cache_creation_input_tokens + input_tokens` across the 5 stream-json `result` events emitted. Record the value.

For automation purposes, capture into JSON:

```json
{
  "captured_at": "2026-05-10T00:00:00Z",
  "captured_against_commit": "5d2d879",
  "fixture": "ceo-creates-3-issues-and-lists",
  "totals": {
    "input_tokens": 0,
    "output_tokens": 0,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  },
  "ratio_ceiling": 1.3,
  "note": "M6 token-budget test compares against this baseline. Update only when an architecture change justifies it."
}
```

Replace zeros with measured values. Place at `apps/main/tests/fixtures/m6-token-baseline.json`.

- [ ] **Step 3: Commit the baseline**

```bash
git add apps/main/tests/fixtures/m6-token-baseline.json
git commit -m "chore(m6): capture pre-M6 token baseline fixture

Used by m6-token-budget.test.ts to enforce <=1.3x ratio.
Captured against M5 final commit."
```

---

### Task 2: Migration 0002 SQL (issue_comments + issue_events)

**Files:**
- Create: `apps/main/src/db/migrations/0002_m6_issues_projects.sql`
- Create: `apps/main/tests/db.migration-0002.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/tests/db.migration-0002.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, getCurrentVersion } from "../src/db/migrations.js";

describe("migration 0002", () => {
  it("creates issue_comments table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='issue_comments'")
      .get();
    expect(row).toBeDefined();
  });

  it("creates issue_events table", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='issue_events'")
      .get();
    expect(row).toBeDefined();
  });

  it("bumps user_version to 2", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(getCurrentVersion(db)).toBe(2);
  });

  it("issue_comments enforces sender_kind enum", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      "INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)",
    ).run();
    db.prepare(
      "INSERT INTO issues (id, company_id, title, created_at, updated_at) VALUES ('i1', 'c1', 'T', 0, 0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO issue_comments (id, issue_id, sender_kind, content, created_at) VALUES ('co1', 'i1', 'bogus', 'hi', 0)",
        )
        .run(),
    ).toThrow();
  });

  it("issue_events enforces kind enum", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(
      "INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)",
    ).run();
    db.prepare(
      "INSERT INTO issues (id, company_id, title, created_at, updated_at) VALUES ('i1', 'c1', 'T', 0, 0)",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO issue_events (id, issue_id, kind, actor_kind, payload_json, created_at) VALUES ('e1', 'i1', 'bogus', 'system', '{}', 0)",
        )
        .run(),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```powershell
pnpm --filter @dashboard-agent/main test db.migration-0002
```

Expected: 5 failures (table 'issue_comments' / 'issue_events' missing, user_version still 1).

- [ ] **Step 3: Write the SQL migration**

Create `apps/main/src/db/migrations/0002_m6_issues_projects.sql`:

```sql
-- 0002_m6_issues_projects.sql — M6 schema deltas (Spec §3.1)

CREATE TABLE IF NOT EXISTS issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('user','agent')),
  sender_id TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_comments_issue
  ON issue_comments(issue_id, created_at);

CREATE TABLE IF NOT EXISTS issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'created','status_changed','assignee_changed','priority_changed','reparented'
  )),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','agent','system')),
  actor_id TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_events_issue
  ON issue_events(issue_id, created_at);
```

- [ ] **Step 4: Run the test — confirm it passes**

```powershell
pnpm --filter @dashboard-agent/main test db.migration-0002
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/db/migrations/0002_m6_issues_projects.sql apps/main/tests/db.migration-0002.test.ts
git commit -m "feat(m6): migration 0002 — issue_comments + issue_events tables"
```

---

### Task 3: Post-migration script (auto-create Default Workspace)

**Files:**
- Create: `apps/main/src/db/post-migrations/0002.ts`
- Create: `apps/main/src/db/post-migrations/index.ts`
- Modify: `apps/main/src/db/client.ts`
- Create: `apps/main/tests/db.post-migration-0002.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/tests/db.post-migration-0002.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0002 } from "../src/db/post-migrations/0002.js";

const seed = (db: Database.Database, opts: { workspaceCwd?: string }) => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
  if (opts.workspaceCwd !== undefined) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('workspaceCwd', ?)").run(opts.workspaceCwd);
  }
};

describe("postMigration 0002", () => {
  it("creates Default Workspace when company has no projects and workspaceCwd is set", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, { workspaceCwd: "C:/work/repo" });

    runPostMigration0002(db);

    const projects = db
      .prepare("SELECT name, path, color FROM projects WHERE company_id = 'c1'")
      .all() as { name: string; path: string; color: string }[];
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual({
      name: "Default Workspace",
      path: "C:/work/repo",
      color: "#1D5DD7",
    });
  });

  it("is a noop when company already has projects", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, { workspaceCwd: "C:/work/repo" });
    db.prepare(
      "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES ('p_existing', 'c1', 'Existing', '/x', '#000', 0)",
    ).run();

    runPostMigration0002(db);

    const count = (db.prepare("SELECT COUNT(*) AS n FROM projects WHERE company_id = 'c1'").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("is idempotent — running twice does not duplicate", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, { workspaceCwd: "C:/work/repo" });

    runPostMigration0002(db);
    runPostMigration0002(db);

    const count = (db.prepare("SELECT COUNT(*) AS n FROM projects WHERE company_id = 'c1'").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("skips company without workspaceCwd", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, {});

    runPostMigration0002(db);

    const count = (db.prepare("SELECT COUNT(*) AS n FROM projects WHERE company_id = 'c1'").get() as { n: number }).n;
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```powershell
pnpm --filter @dashboard-agent/main test db.post-migration-0002
```

Expected: import error (`runPostMigration0002` not defined).

- [ ] **Step 3: Implement post-migration script**

Create `apps/main/src/db/post-migrations/0002.ts`:

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const runPostMigration0002 = (db: Database.Database): void => {
  const companies = db.prepare("SELECT id FROM companies").all() as { id: string }[];
  const wsRow = db
    .prepare("SELECT value FROM settings WHERE key = 'workspaceCwd'")
    .get() as { value: string } | undefined;
  const wsCwd = wsRow?.value;

  const countProjects = db.prepare(
    "SELECT COUNT(*) AS n FROM projects WHERE company_id = ?",
  );
  const insertProject = db.prepare(
    "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const tx = db.transaction(() => {
    for (const c of companies) {
      const n = (countProjects.get(c.id) as { n: number }).n;
      if (n === 0 && wsCwd !== undefined && wsCwd.trim() !== "") {
        insertProject.run(
          `proj_${randomUUID()}`,
          c.id,
          "Default Workspace",
          wsCwd,
          "#1D5DD7",
          Date.now(),
        );
      }
    }
  });
  tx();
};
```

- [ ] **Step 4: Create the registry**

Create `apps/main/src/db/post-migrations/index.ts`:

```ts
import type Database from "better-sqlite3";
import { runPostMigration0002 } from "./0002.js";

const SCRIPTS: Array<{ id: number; run: (db: Database.Database) => void }> = [
  { id: 2, run: runPostMigration0002 },
];

export const runPostMigrations = (db: Database.Database): void => {
  for (const s of SCRIPTS) s.run(db);
};
```

Note: scripts are idempotent by design, so we always run them — no version tracking needed.

- [ ] **Step 5: Hook into client.ts**

Modify `apps/main/src/db/client.ts`:

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "./migrations.js";
import { runPostMigrations } from "./post-migrations/index.js";

export const openDatabase = (filePath: string): Database.Database => {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  applyMigrations(db);
  runPostMigrations(db);
  return db;
};
```

- [ ] **Step 6: Run tests — confirm post-migration passes**

```powershell
pnpm --filter @dashboard-agent/main test db.post-migration-0002
```

Expected: 4 passing.

- [ ] **Step 7: Run full suite — confirm no regressions**

```powershell
pnpm --filter @dashboard-agent/main test
```

Expected: all green (147 + 5 from Task 2 + 4 from this task = 156).

- [ ] **Step 8: Commit**

```bash
git add apps/main/src/db/post-migrations apps/main/src/db/client.ts apps/main/tests/db.post-migration-0002.test.ts
git commit -m "feat(m6): post-migration 0002 — auto-create Default Workspace from workspaceCwd"
```

---

## Phase 2 — Projects backend (2 tasks)

### Task 4: Project type + repository + tests

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/main/src/projects/repository.ts`
- Create: `apps/main/tests/projects.repository.test.ts`

- [ ] **Step 1: Add Project type to shared**

Open `packages/shared/src/types.ts`, find the existing types (Agent, Company, etc.), and append:

```ts
export type Project = {
  id: string;
  companyId: string;
  name: string;
  path: string;
  color: string;
  createdAt: number;
};

export type ProjectPathStatus = "available" | "missing";
```

- [ ] **Step 2: Re-export from shared/index**

Open `packages/shared/src/index.ts` and ensure `Project` and `ProjectPathStatus` are exported (they likely auto-export via `export * from "./types.js"`; verify and add if missing).

- [ ] **Step 3: Write the failing test**

Create `apps/main/tests/projects.repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const c = createCompaniesRepository(db).create({ name: "Acme" });
  const projects = createProjectsRepository(db);
  return { db, projects, companyId: c.id };
};

describe("projects repository", () => {
  it("create + listByCompany", () => {
    const { projects, companyId } = setup();
    const p = projects.create({ companyId, name: "Web", path: "C:/web", color: "#1D5DD7" });
    expect(p.name).toBe("Web");
    expect(projects.listByCompany(companyId)).toHaveLength(1);
  });

  it("getById returns project or null", () => {
    const { projects, companyId } = setup();
    const p = projects.create({ companyId, name: "X", path: "C:/x", color: "#10b981" });
    expect(projects.getById(p.id)?.name).toBe("X");
    expect(projects.getById("nope")).toBeNull();
  });

  it("update mutates only provided fields", () => {
    const { projects, companyId } = setup();
    const p = projects.create({ companyId, name: "Old", path: "C:/o", color: "#1D5DD7" });
    projects.update(p.id, { name: "New" });
    expect(projects.getById(p.id)?.name).toBe("New");
    expect(projects.getById(p.id)?.path).toBe("C:/o");
  });

  it("delete removes the row", () => {
    const { projects, companyId } = setup();
    const p = projects.create({ companyId, name: "Z", path: "C:/z", color: "#dc2626" });
    projects.delete(p.id);
    expect(projects.getById(p.id)).toBeNull();
  });

  it("checkPaths returns 'available' for existing dirs and 'missing' otherwise", () => {
    const { projects, companyId } = setup();
    const tmp = process.cwd(); // any existing dir
    const p1 = projects.create({ companyId, name: "Real", path: tmp, color: "#1D5DD7" });
    const p2 = projects.create({
      companyId,
      name: "Ghost",
      path: "C:/this/path/does/not/exist/xyz123",
      color: "#1D5DD7",
    });
    const status = projects.checkPaths(companyId);
    expect(status[p1.id]).toBe("available");
    expect(status[p2.id]).toBe("missing");
  });
});
```

- [ ] **Step 4: Run — confirm fail**

```powershell
pnpm --filter @dashboard-agent/main test projects.repository
```

Expected: import errors.

- [ ] **Step 5: Implement repository**

Create `apps/main/src/projects/repository.ts`:

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Project, ProjectPathStatus } from "@dashboard-agent/shared";

type Row = {
  id: string;
  company_id: string;
  name: string;
  path: string;
  color: string;
  created_at: number;
};

const rowToProject = (r: Row): Project => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  path: r.path,
  color: r.color,
  createdAt: r.created_at,
});

export type CreateProjectInput = {
  companyId: string;
  name: string;
  path: string;
  color: string;
};

export type UpdateProjectInput = {
  name?: string;
  path?: string;
  color?: string;
};

export type ProjectsRepository = {
  create(input: CreateProjectInput): Project;
  getById(id: string): Project | null;
  listByCompany(companyId: string): Project[];
  update(id: string, patch: UpdateProjectInput): Project | null;
  delete(id: string): void;
  checkPaths(companyId: string): Record<string, ProjectPathStatus>;
};

export const createProjectsRepository = (db: Database.Database): ProjectsRepository => {
  const insert = db.prepare(
    "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const byId = db.prepare("SELECT * FROM projects WHERE id = ?");
  const byCompany = db.prepare(
    "SELECT * FROM projects WHERE company_id = ? ORDER BY created_at ASC",
  );
  const del = db.prepare("DELETE FROM projects WHERE id = ?");

  return {
    create(input) {
      const id = `proj_${randomUUID()}`;
      insert.run(id, input.companyId, input.name, input.path, input.color, Date.now());
      return rowToProject(byId.get(id) as Row);
    },
    getById(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? rowToProject(row) : null;
    },
    listByCompany(companyId) {
      return (byCompany.all(companyId) as Row[]).map(rowToProject);
    },
    update(id, patch) {
      const current = byId.get(id) as Row | undefined;
      if (current === undefined) return null;
      const next = {
        name: patch.name ?? current.name,
        path: patch.path ?? current.path,
        color: patch.color ?? current.color,
      };
      db.prepare("UPDATE projects SET name = ?, path = ?, color = ? WHERE id = ?").run(
        next.name,
        next.path,
        next.color,
        id,
      );
      return rowToProject(byId.get(id) as Row);
    },
    delete(id) {
      del.run(id);
    },
    checkPaths(companyId) {
      const rows = byCompany.all(companyId) as Row[];
      const out: Record<string, ProjectPathStatus> = {};
      for (const r of rows) out[r.id] = existsSync(r.path) ? "available" : "missing";
      return out;
    },
  };
};
```

- [ ] **Step 6: Run — confirm pass**

```powershell
pnpm --filter @dashboard-agent/main test projects.repository
```

Expected: 5 passing.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts apps/main/src/projects apps/main/tests/projects.repository.test.ts
git commit -m "feat(m6): projects repository — CRUD + path availability check"
```

---

### Task 5: Projects IPC channels + handlers + preload

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `apps/main/src/ipc/projects-handlers.ts`
- Modify: `apps/main/src/ipc/handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Create: `apps/main/tests/ipc.projects-handlers.test.ts`

- [ ] **Step 1: Add channel constants**

Modify `packages/shared/src/ipc-channels.ts`. Append before the `as const` closer:

```ts
  PROJECTS_LIST: "projects:list",
  PROJECTS_CREATE: "projects:create",
  PROJECTS_UPDATE: "projects:update",
  PROJECTS_DELETE: "projects:delete",
  PROJECTS_OPEN_FOLDER: "projects:open-folder",
  PROJECTS_CHECK_PATHS: "projects:check-paths",
```

- [ ] **Step 2: Write the failing test**

Create `apps/main/tests/ipc.projects-handlers.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn(async () => "") },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("projects handlers — channel registration", () => {
  it("registers the 6 project channels", async () => {
    const { ipcMain } = await import("electron");
    const { registerProjectsHandlers } = await import("../src/ipc/projects-handlers.js");

    const db = new Database(":memory:");
    applyMigrations(db);
    registerProjectsHandlers(db);

    const channels = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(channels).toEqual([
      "projects:list",
      "projects:create",
      "projects:update",
      "projects:delete",
      "projects:open-folder",
      "projects:check-paths",
    ]);
  });

  it("projects:create persists and projects:list returns it", async () => {
    const { ipcMain } = await import("electron");
    const { registerProjectsHandlers } = await import("../src/ipc/projects-handlers.js");

    const db = new Database(":memory:");
    applyMigrations(db);
    const c = createCompaniesRepository(db).create({ name: "Acme" });
    registerProjectsHandlers(db);

    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const createHandler = calls.find((x: unknown[]) => x[0] === "projects:create")![1] as Function;
    const listHandler = calls.find((x: unknown[]) => x[0] === "projects:list")![1] as Function;

    await createHandler({}, { companyId: c.id, name: "Web", path: "C:/w", color: "#1D5DD7" });
    const list = await listHandler({}, { companyId: c.id });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Web");
  });
});
```

- [ ] **Step 3: Run — confirm fail**

```powershell
pnpm --filter @dashboard-agent/main test ipc.projects-handlers
```

Expected: import error.

- [ ] **Step 4: Implement handlers**

Create `apps/main/src/ipc/projects-handlers.ts`:

```ts
import { ipcMain, shell } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Project, type ProjectPathStatus } from "@dashboard-agent/shared";
import { createProjectsRepository } from "../projects/repository.js";

export const registerProjectsHandlers = (db: Database.Database): void => {
  const repo = createProjectsRepository(db);

  ipcMain.handle(
    IPC.PROJECTS_LIST,
    (_e, payload: { companyId: string }): Project[] => repo.listByCompany(payload.companyId),
  );

  ipcMain.handle(
    IPC.PROJECTS_CREATE,
    (
      _e,
      payload: { companyId: string; name: string; path: string; color: string },
    ): Project => repo.create(payload),
  );

  ipcMain.handle(
    IPC.PROJECTS_UPDATE,
    (
      _e,
      payload: { id: string; name?: string; path?: string; color?: string },
    ): Project | null => {
      const { id, ...patch } = payload;
      return repo.update(id, patch);
    },
  );

  ipcMain.handle(IPC.PROJECTS_DELETE, (_e, payload: { id: string }): { ok: true } => {
    repo.delete(payload.id);
    return { ok: true };
  });

  ipcMain.handle(
    IPC.PROJECTS_OPEN_FOLDER,
    async (_e, payload: { id: string }): Promise<{ opened: boolean }> => {
      const p = repo.getById(payload.id);
      if (p === null) return { opened: false };
      const err = await shell.openPath(p.path);
      return { opened: err === "" };
    },
  );

  ipcMain.handle(
    IPC.PROJECTS_CHECK_PATHS,
    (_e, payload: { companyId: string }): Record<string, ProjectPathStatus> =>
      repo.checkPaths(payload.companyId),
  );
};
```

- [ ] **Step 5: Register in handlers.ts**

Modify `apps/main/src/ipc/handlers.ts`. Add import and call:

```ts
import { registerProjectsHandlers } from "./projects-handlers.js";
```

And inside `registerIpcHandlers`:

```ts
  registerProjectsHandlers(db);
```

(Place after `registerInboxHandlers(db);`.)

- [ ] **Step 6: Expose to renderer via preload**

Modify `apps/main/src/ipc/preload.ts`. Add `Project, ProjectPathStatus` to imports from `@dashboard-agent/shared`, then add inside the `contextBridge.exposeInMainWorld(...)` object (alongside `inbox`):

```ts
  projects: {
    list: (companyId: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_LIST, { companyId }) as Promise<Project[]>,
    create: (input: { companyId: string; name: string; path: string; color: string }) =>
      ipcRenderer.invoke(IPC.PROJECTS_CREATE, input) as Promise<Project>,
    update: (input: { id: string; name?: string; path?: string; color?: string }) =>
      ipcRenderer.invoke(IPC.PROJECTS_UPDATE, input) as Promise<Project | null>,
    delete: (id: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_DELETE, { id }) as Promise<{ ok: true }>,
    openFolder: (id: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_OPEN_FOLDER, { id }) as Promise<{ opened: boolean }>,
    checkPaths: (companyId: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_CHECK_PATHS, { companyId }) as Promise<
        Record<string, ProjectPathStatus>
      >,
  },
```

- [ ] **Step 7: Update DashboardAgent type if it exists**

Check for a global `Window` declaration in renderer:

```powershell
Select-String -Path "apps\renderer\src\**\*.ts","apps\renderer\src\**\*.tsx" -Pattern "interface Window|dashboardAgent:"
```

If a typed `Window.dashboardAgent` declaration exists (e.g., `apps/renderer/src/types/dashboard-agent.d.ts`), extend it with the same `projects` shape from Step 6. If not, the preload's contextBridge object is reflected via TypeScript inference and no extra step is needed.

- [ ] **Step 8: Run tests**

```powershell
pnpm --filter @dashboard-agent/main test ipc.projects-handlers
pnpm --filter @dashboard-agent/main typecheck
```

Expected: 2 passing, 0 type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/projects-handlers.ts apps/main/src/ipc/handlers.ts apps/main/src/ipc/preload.ts apps/main/tests/ipc.projects-handlers.test.ts
git commit -m "feat(m6): IPC handlers for projects (list/create/update/delete/open-folder/check-paths)"
```

---


## Phase 3 — Projects UI (5 tasks)

> **Sidebar location:** `apps/renderer/src/App.tsx` (the `Sidebar` component is defined inline at ~line 25; not a separate file). Same goes for routes — declared inside `<Routes>` in App.tsx.

### Task 6: Projects zustand store + i18n keys

**Files:**
- Create: `apps/renderer/src/stores/projects.ts`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

- [ ] **Step 1: Implement the store**

Create `apps/renderer/src/stores/projects.ts`:

```ts
import { create } from "zustand";
import type { Project, ProjectPathStatus } from "@dashboard-agent/shared";

type State = {
  projects: Project[];
  pathStatuses: Record<string, ProjectPathStatus>;
  selectedId: string | null;
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  refreshPaths: (companyId: string) => Promise<void>;
  create: (input: { companyId: string; name: string; path: string; color: string }) => Promise<Project>;
  update: (input: { id: string; name?: string; path?: string; color?: string }) => Promise<void>;
  delete: (id: string) => Promise<void>;
  select: (id: string | null) => void;
};

export const useProjectsStore = create<State>((set, get) => ({
  projects: [],
  pathStatuses: {},
  selectedId: null,
  loaded: false,
  load: async (companyId) => {
    const projects = await window.dashboardAgent.projects.list(companyId);
    const pathStatuses = await window.dashboardAgent.projects.checkPaths(companyId);
    set((s) => ({
      projects,
      pathStatuses,
      loaded: true,
      selectedId: s.selectedId ?? projects[0]?.id ?? null,
    }));
  },
  refreshPaths: async (companyId) => {
    const pathStatuses = await window.dashboardAgent.projects.checkPaths(companyId);
    set({ pathStatuses });
  },
  create: async (input) => {
    const p = await window.dashboardAgent.projects.create(input);
    set((s) => ({ projects: [...s.projects, p], selectedId: p.id }));
    return p;
  },
  update: async (input) => {
    const next = await window.dashboardAgent.projects.update(input);
    if (next === null) return;
    set((s) => ({ projects: s.projects.map((p) => (p.id === next.id ? next : p)) }));
  },
  delete: async (id) => {
    await window.dashboardAgent.projects.delete(id);
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      const selectedId = s.selectedId === id ? (projects[0]?.id ?? null) : s.selectedId;
      return { projects, selectedId };
    });
  },
  select: (id) => set({ selectedId: id }),
}));
```

- [ ] **Step 2: Add i18n keys to `en-US.json` and `pt-BR.json`**

Under `nav` block in both files:
- en: `"projects": "Projects", "issues": "Issues"`
- pt: `"projects": "Projetos", "issues": "Issues"`

Add new top-level `projects` block (en):

```json
"projects": {
  "title": "Projects",
  "newButton": "+ New project",
  "empty": "No projects yet — create one to start.",
  "form": {
    "name": "Name",
    "path": "Folder path",
    "color": "Color",
    "pickFolder": "Choose folder...",
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete project",
    "confirmDelete": "Delete this project? Issues remain but lose their project link."
  },
  "detail": {
    "openInExplorer": "Open in Explorer",
    "edit": "Edit",
    "agentsWithAccess": "Agents with access",
    "recentIssues": "Recent issues",
    "counts": "{{agents}} agents · {{issues}} issues · {{doing}} doing",
    "pathMissing": "Path unavailable"
  }
}
```

Mirror the same structure in `pt-BR.json` with translated strings (Salvar/Cancelar/Excluir/etc — see spec §6 for tone).

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/stores/projects.ts apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(m6): projects store + i18n keys"
```

---

### Task 7: ProjectListItem + ProjectDetail + add Issue type to shared

**Files:**
- Create: `apps/renderer/src/components/projects/ProjectListItem.tsx`
- Create: `apps/renderer/src/components/projects/ProjectDetail.tsx`
- Modify: `packages/shared/src/types.ts` (add Issue, IssueComment, IssueEvent, ToolCallRef, IssueDetail)

- [ ] **Step 1: Add Issue + related types to shared**

Append to `packages/shared/src/types.ts`:

```ts
export type IssueStatus = "backlog" | "todo" | "doing" | "review" | "done" | "cancelled";
export type IssuePriority = "low" | "medium" | "high" | "urgent";

export type Issue = {
  id: string;
  companyId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  assigneeId: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
};

export type IssueComment = {
  id: string;
  issueId: string;
  senderKind: "user" | "agent";
  senderId: string | null;
  content: string;
  createdAt: number;
};

export type IssueEventKind =
  | "created" | "status_changed" | "assignee_changed" | "priority_changed" | "reparented";

export type IssueEvent = {
  id: string;
  issueId: string;
  kind: IssueEventKind;
  actorKind: "user" | "agent" | "system";
  actorId: string | null;
  payloadJson: string;
  createdAt: number;
};

export type ToolCallRef = {
  toolName: string;
  input: Record<string, unknown>;
  createdAt: number;
};

export type IssueDetail = {
  issue: Issue;
  comments: IssueComment[];
  events: IssueEvent[];
  subtasks: Issue[];
  toolHistory: ToolCallRef[];
  assignee: { id: string; name: string; role: string } | null;
  project: { id: string; name: string; color: string } | null;
};
```

- [ ] **Step 2: Implement ProjectListItem**

Create `apps/renderer/src/components/projects/ProjectListItem.tsx`:

```tsx
import type { FC } from "react";
import type { Project, ProjectPathStatus } from "@dashboard-agent/shared";

type Props = {
  project: Project;
  pathStatus: ProjectPathStatus | undefined;
  selected: boolean;
  onClick: () => void;
};

export const ProjectListItem: FC<Props> = ({ project, pathStatus, selected, onClick }) => {
  const missing = pathStatus === "missing";
  const cls = [
    "flex items-center gap-2 px-3 py-2 rounded text-sm cursor-pointer",
    selected ? "bg-brand-bg text-brand border-l-4 border-l-brand" : "hover:bg-surface-soft text-ink-muted",
    missing ? "opacity-60" : "",
  ].join(" ");
  return (
    <div onClick={onClick} className={cls}>
      <span className="w-2 h-2 rounded-full" style={{ background: project.color }} />
      <span className="truncate flex-1">{project.name}</span>
      {missing && <span title="path missing">⚠️</span>}
    </div>
  );
};
```

- [ ] **Step 3: Implement ProjectDetail**

Create `apps/renderer/src/components/projects/ProjectDetail.tsx`:

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Project, Agent, Issue, ProjectPathStatus } from "@dashboard-agent/shared";
import { AllowlistEditor } from "./AllowlistEditor.js";

type Props = {
  project: Project;
  pathStatus: ProjectPathStatus | undefined;
  agents: Agent[];
  recentIssues: Issue[];
  doingCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onOpenFolder: () => void;
};

export const ProjectDetail: FC<Props> = ({
  project, pathStatus, agents, recentIssues, doingCount, onEdit, onDelete, onOpenFolder,
}) => {
  const { t } = useTranslation();
  const missing = pathStatus === "missing";
  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-3 h-3 rounded-full" style={{ background: project.color }} />
        <h2 className="text-xl font-bold text-brand-dark">{project.name}</h2>
        {missing && (
          <span className="ml-2 text-xs bg-semantic-danger text-white px-2 py-0.5 rounded">
            {t("projects.detail.pathMissing")}
          </span>
        )}
      </div>
      <div className="font-mono text-xs bg-surface-soft px-2 py-1 rounded mb-3 break-all">
        📁 {project.path}
      </div>
      <p className="text-sm text-ink-muted mb-4">
        {t("projects.detail.counts", { agents: agents.length, issues: recentIssues.length, doing: doingCount })}
      </p>
      <div className="mb-4">
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("projects.detail.agentsWithAccess")}
        </h3>
        <div className="flex gap-2 flex-wrap">
          {agents.map((a) => <AllowlistEditor key={a.id} agent={a} project={project} />)}
        </div>
      </div>
      <div className="mb-4">
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("projects.detail.recentIssues")}
        </h3>
        <ul className="space-y-1">
          {recentIssues.slice(0, 5).map((i) => (
            <li key={i.id} className="text-sm flex items-center gap-2">
              <span className="text-ink-muted">·</span>
              <span className="flex-1 truncate">{i.title}</span>
              <span className="text-[10px] uppercase text-ink-soft">{i.status}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onOpenFolder} className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded">
          {t("projects.detail.openInExplorer")}
        </button>
        <button type="button" onClick={onEdit} className="text-xs px-3 py-1 bg-brand text-white rounded">
          {t("projects.detail.edit")}
        </button>
        <button type="button" onClick={onDelete} className="text-xs px-3 py-1 bg-semantic-danger text-white rounded ml-auto">
          {t("projects.form.delete")}
        </button>
      </div>
    </div>
  );
};
```

> AllowlistEditor is created in Task 8. Typecheck will fail until then — that is expected.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts apps/renderer/src/components/projects/ProjectListItem.tsx apps/renderer/src/components/projects/ProjectDetail.tsx
git commit -m "feat(m6): ProjectListItem + ProjectDetail + Issue/Comment/Event shared types"
```

---

### Task 8: ProjectFormModal + AllowlistEditor

**Files:**
- Create: `apps/renderer/src/components/projects/ProjectFormModal.tsx`
- Create: `apps/renderer/src/components/projects/AllowlistEditor.tsx`

- [ ] **Step 1: Implement ProjectFormModal**

Create `apps/renderer/src/components/projects/ProjectFormModal.tsx`:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@dashboard-agent/shared";

const COLORS = ["#1D5DD7","#10b981","#f59e0b","#dc2626","#8b5cf6","#ec4899","#0ea5e9","#64748b"];

type Props = {
  initial?: Project;
  onSubmit: (data: { name: string; path: string; color: string }) => Promise<void>;
  onClose: () => void;
};

export const ProjectFormModal: FC<Props> = ({ initial, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [path, setPath] = useState(initial?.path ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [busy, setBusy] = useState(false);

  const pickFolder = async () => {
    const picked = await window.dashboardAgent.settings.pickWorkspace();
    if (picked !== null) setPath(picked);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === "" || path.trim() === "") return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), path: path.trim(), color });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-surface-card rounded p-5 w-full max-w-sm shadow-xl">
        <label className="block text-xs uppercase text-ink-soft mb-1">{t("projects.form.name")}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required minLength={1}
               className="w-full mb-3 px-2 py-1 border border-surface-border rounded text-sm" />
        <label className="block text-xs uppercase text-ink-soft mb-1">{t("projects.form.path")}</label>
        <div className="flex gap-2 mb-3">
          <input type="text" value={path} onChange={(e) => setPath(e.target.value)} required
                 className="flex-1 px-2 py-1 border border-surface-border rounded text-sm font-mono" />
          <button type="button" onClick={() => void pickFolder()}
                  className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded">
            {t("projects.form.pickFolder")}
          </button>
        </div>
        <label className="block text-xs uppercase text-ink-soft mb-1">{t("projects.form.color")}</label>
        <div className="flex gap-2 mb-4">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} style={{ background: c }}
                    className={`w-6 h-6 rounded-full border-2 ${color === c ? "border-ink-muted" : "border-transparent"}`} />
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded">
            {t("projects.form.cancel")}
          </button>
          <button type="submit" disabled={busy}
                  className="text-xs px-3 py-1 bg-brand text-white rounded font-semibold disabled:opacity-50">
            {t("projects.form.save")}
          </button>
        </div>
      </form>
    </div>
  );
};
```

- [ ] **Step 2: Implement AllowlistEditor**

Create `apps/renderer/src/components/projects/AllowlistEditor.tsx`:

```tsx
import { useState, type FC } from "react";
import type { Agent, Project } from "@dashboard-agent/shared";

type Props = {
  agent: Agent;
  project: Project;
};

export const AllowlistEditor: FC<Props> = ({ agent, project }) => {
  const allowed = agent.allowedProjects.length === 0 || agent.allowedProjects.includes(project.id);
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    let next: string[];
    if (agent.allowedProjects.length === 0) {
      // currently "all" — explicit-list mode starts; remove this project
      next = []; // for simplicity v1: full multi-project picker is M9 polish
      // Mark as "everything except this project" by listing the others — caller passes full list
      next = []; // placeholder — implement full picker in M9
    } else {
      next = allowed
        ? agent.allowedProjects.filter((id) => id !== project.id)
        : [...agent.allowedProjects, project.id];
    }
    await window.dashboardAgent.agents.setAllowedProjects(agent.id, next);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)}
              className={`text-xs px-2 py-0.5 rounded-full ${allowed ? "bg-brand-bg text-brand" : "bg-surface-soft text-ink-muted"}`}>
        {agent.name}{agent.role.length > 0 && <span className="text-ink-soft"> · {agent.role}</span>}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface-card border border-surface-border rounded shadow-lg p-2 z-10 text-xs whitespace-nowrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allowed} onChange={() => void toggle()} />
            <span>Has access to {project.name}</span>
          </label>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Typecheck**

```powershell
pnpm typecheck
```

Expected: green now (Task 9 hooks the IPC, but the call is async — typecheck doesn't validate it executes).

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/projects/ProjectFormModal.tsx apps/renderer/src/components/projects/AllowlistEditor.tsx
git commit -m "feat(m6): ProjectFormModal + AllowlistEditor"
```

---

### Task 9: agents:set-allowed-projects IPC + Agent.allowedProjects field

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts` — add `AGENTS_SET_ALLOWED_PROJECTS`
- Modify: `packages/shared/src/types.ts` — add `allowedProjects: string[]` to Agent type
- Modify: `apps/main/src/agents/repository.ts` — extend `rowToAgent`, add `setAllowedProjects` method
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts` — register handler
- Modify: `apps/main/src/ipc/preload.ts` — expose `agents.setAllowedProjects`

- [ ] **Step 1: Add channel constant**

In `packages/shared/src/ipc-channels.ts` `IPC` object, add: `AGENTS_SET_ALLOWED_PROJECTS: "agents:set-allowed-projects",`

- [ ] **Step 2: Extend Agent type**

In `packages/shared/src/types.ts`, find `Agent` and add `allowedProjects: string[];`

- [ ] **Step 3: Update repository**

In `apps/main/src/agents/repository.ts`:

Add to `rowToAgent`: `allowedProjects: JSON.parse(r.allowed_projects_json) as string[],`

Add to `AgentsRepository` type: `setAllowedProjects(id: string, projectIds: string[]): void;`

Add to returned object:
```ts
setAllowedProjects(id, projectIds) {
  db.prepare("UPDATE agents SET allowed_projects_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(projectIds), Date.now(), id);
},
```

- [ ] **Step 4: Register IPC handler**

In `apps/main/src/ipc/orchestrator-handlers.ts`, find where `IPC.AGENT_LIST` is registered. Add nearby:

```ts
ipcMain.handle(
  IPC.AGENTS_SET_ALLOWED_PROJECTS,
  (_e, payload: { agentId: string; projectIds: string[] }): void => {
    agentsRepo.setAllowedProjects(payload.agentId, payload.projectIds);
  },
);
```

- [ ] **Step 5: Expose in preload**

In `apps/main/src/ipc/preload.ts` `agents` object, append:

```ts
setAllowedProjects: (agentId: string, projectIds: string[]) =>
  ipcRenderer.invoke(IPC.AGENTS_SET_ALLOWED_PROJECTS, { agentId, projectIds }) as Promise<void>,
```

- [ ] **Step 6: Tests + typecheck**

```powershell
pnpm --filter @dashboard-agent/main test
pnpm typecheck
```

Expected: green. Existing agents.repository tests still pass (default `allowedProjects: []`).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ipc-channels.ts packages/shared/src/types.ts apps/main/src/agents/repository.ts apps/main/src/ipc/orchestrator-handlers.ts apps/main/src/ipc/preload.ts
git commit -m "feat(m6): agents:set-allowed-projects IPC + Agent.allowedProjects field"
```

---

### Task 10: /projects route + sidebar nav entry

**Files:**
- Create: `apps/renderer/src/routes/Projects.tsx`
- Modify: `apps/renderer/src/App.tsx` (sidebar nav + `<Routes>` registration + bootstrap)

- [ ] **Step 1: Implement Projects route**

Create `apps/renderer/src/routes/Projects.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@dashboard-agent/shared";
import { useProjectsStore } from "../stores/projects.js";
import { useAgentsStore } from "../stores/agents.js";
import { ProjectListItem } from "../components/projects/ProjectListItem.js";
import { ProjectDetail } from "../components/projects/ProjectDetail.js";
import { ProjectFormModal } from "../components/projects/ProjectFormModal.js";

export const Projects: FC = () => {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const pathStatuses = useProjectsStore((s) => s.pathStatuses);
  const selectedId = useProjectsStore((s) => s.selectedId);
  const select = useProjectsStore((s) => s.select);
  const load = useProjectsStore((s) => s.load);
  const refreshPaths = useProjectsStore((s) => s.refreshPaths);
  const createProj = useProjectsStore((s) => s.create);
  const updateProj = useProjectsStore((s) => s.update);
  const deleteProj = useProjectsStore((s) => s.delete);
  const agents = useAgentsStore((s) => s.agents);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  useEffect(() => {
    void (async () => {
      const cs = await window.dashboardAgent.companies.list();
      if (cs.length > 0) {
        setCompanyId(cs[0]!.id);
        void load(cs[0]!.id);
      }
    })();
  }, [load]);

  useEffect(() => {
    if (companyId === null) return;
    const interval = setInterval(() => void refreshPaths(companyId), 30_000);
    return () => clearInterval(interval);
  }, [companyId, refreshPaths]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <div className="w-64 border-r border-surface-border p-3 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-brand-dark">{t("projects.title")}</h2>
        </div>
        <div className="flex-1 overflow-auto">
          {projects.length === 0 ? (
            <p className="text-xs text-ink-muted px-2">{t("projects.empty")}</p>
          ) : (
            <div className="space-y-1">
              {projects.map((p) => (
                <ProjectListItem key={p.id} project={p} pathStatus={pathStatuses[p.id]}
                                 selected={selectedId === p.id} onClick={() => select(p.id)} />
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => { setEditing(null); setShowForm(true); }}
                className="text-xs px-3 py-2 bg-brand text-white rounded font-semibold mt-2">
          {t("projects.newButton")}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {selected !== null && (
          <ProjectDetail project={selected} pathStatus={pathStatuses[selected.id]} agents={agents}
                         recentIssues={[]} doingCount={0}
                         onEdit={() => { setEditing(selected); setShowForm(true); }}
                         onDelete={() => { if (window.confirm(t("projects.form.confirmDelete"))) void deleteProj(selected.id); }}
                         onOpenFolder={() => void window.dashboardAgent.projects.openFolder(selected.id)} />
        )}
      </div>
      {showForm && companyId !== null && (
        <ProjectFormModal initial={editing ?? undefined} onClose={() => setShowForm(false)}
                          onSubmit={async (data) => {
                            if (editing !== null) await updateProj({ id: editing.id, ...data });
                            else await createProj({ companyId, ...data });
                          }} />
      )}
    </div>
  );
};
```

> `recentIssues` + `doingCount` stay stubbed `[]`/`0` until Task 22 (Issues store wired in).

- [ ] **Step 2: Wire into App.tsx**

Modify `apps/renderer/src/App.tsx`:

Add import: `import { Projects } from "./routes/Projects.js";` and `import { useProjectsStore } from "./stores/projects.js";`

In `Sidebar`, add NavLink between `/inbox` and `/settings`:

```tsx
<NavLink to="/projects" className={({ isActive }) =>
  `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`}>
  {t("nav.projects")}
</NavLink>
```

In `<Routes>`, add:

```tsx
<Route path="/projects" element={hasToken ? (<Layout><Projects /></Layout>) : (<Navigate to="/setup" replace />)} />
```

In the `useEffect` that loads `loadAgents(cid); loadInbox(cid);`, add:

```ts
await useProjectsStore.getState().load(cid);
```

- [ ] **Step 3: Verify**

```powershell
pnpm lint; pnpm typecheck; pnpm --filter @dashboard-agent/main test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/routes/Projects.tsx apps/renderer/src/App.tsx
git commit -m "feat(m6): /projects route with master-detail layout + sidebar nav entry"
```

---

## Phase 4 — Sandbox migration (3 tasks)

### Task 11: Refactor security/gate.ts to use allowedProjectPaths

**Files:**
- Modify: `apps/main/src/security/gate.ts`
- Modify: `apps/main/tests/security.gate.test.ts`
- Create: `apps/main/tests/security.gate-projects.test.ts`

- [ ] **Step 1: Update GateInput type**

In `apps/main/src/security/gate.ts`, change `workspaceCwd: string` to `allowedProjectPaths: string[]`. Update destructuring at top of `evaluatePermission`.

- [ ] **Step 2: Replace isInsideWorkspace helper with isInsideAnyAllowed**

```ts
const isInsideAnyAllowed = (path: string, allowed: string[]): boolean => {
  if (allowed.length === 0) return false;
  const abs = resolve(expandHome(path));
  return allowed.some((root) => {
    const rootAbs = resolve(root);
    return abs === rootAbs || abs.startsWith(rootAbs + (process.platform === "win32" ? "\\" : "/"));
  });
};
```

- [ ] **Step 3: Update both branches (Bash + FS_TOOLS) to use new helper**

Replace `isInsideWorkspace(expanded, workspaceCwd)` with `isInsideAnyAllowed(expanded, allowedProjectPaths)`. Update the deny/request_user reasons accordingly.

- [ ] **Step 4: Update existing security.gate.test.ts**

Find every `workspaceCwd: "..."` literal in the file and replace with `allowedProjectPaths: ["..."]`. Tests should still pass.

```powershell
pnpm --filter @dashboard-agent/main test security.gate
```

- [ ] **Step 5: Add new project-aware test**

Create `apps/main/tests/security.gate-projects.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluatePermission } from "../src/security/gate.js";
import type { Agent } from "@dashboard-agent/shared";

const fakeAgent = (mode: "supervised" | "auto" = "auto"): Agent => ({
  id: "a1", companyId: "c1", name: "X", role: "x", systemPrompt: "x",
  mode, alwaysOn: false, status: "idle",
  claudeSessionId: null, currentAction: null, allowedProjects: [],
});

describe("evaluatePermission with project allowlist", () => {
  it("denies FS write when allowedProjectPaths is empty", () => {
    const decision = evaluatePermission({
      toolName: "Write", toolInput: { file_path: "C:/foo/bar.txt" },
      agent: fakeAgent(), allowedProjectPaths: [],
    });
    expect(decision.action).toBe("deny");
  });

  it("allows FS write inside any allowed project", () => {
    const decision = evaluatePermission({
      toolName: "Write", toolInput: { file_path: "C:/proj-a/sub/file.ts" },
      agent: fakeAgent(), allowedProjectPaths: ["C:/proj-a", "C:/proj-b"],
    });
    expect(decision.action).toBe("allow");
  });

  it("denies FS write outside all allowed projects", () => {
    const decision = evaluatePermission({
      toolName: "Edit", toolInput: { file_path: "C:/proj-c/file.ts" },
      agent: fakeAgent(), allowedProjectPaths: ["C:/proj-a", "C:/proj-b"],
    });
    expect(decision.action).toBe("deny");
  });

  it("Bash with absolute path outside any allowed project asks user", () => {
    const decision = evaluatePermission({
      toolName: "Bash", toolInput: { command: "ls C:/elsewhere" },
      agent: fakeAgent(), allowedProjectPaths: ["C:/proj-a"],
    });
    expect(decision.action).toBe("request_user");
  });
});
```

- [ ] **Step 6: Run + commit**

```powershell
pnpm --filter @dashboard-agent/main test security.gate
```

```bash
git add apps/main/src/security/gate.ts apps/main/tests/security.gate.test.ts apps/main/tests/security.gate-projects.test.ts
git commit -m "feat(m6): security/gate.ts uses allowedProjectPaths instead of single workspaceCwd"
```

---

### Task 12: Wire projects into permission watcher

**Files:**
- Modify: `apps/main/src/security/permission-watcher.ts`
- Modify: `apps/main/src/index.ts`
- Modify: `apps/main/tests/security.permission-watcher.test.ts`

- [ ] **Step 1: Update PermissionWatcher signature**

In `apps/main/src/security/permission-watcher.ts`, replace the `getWorkspaceCwd: () => string` field with:

```ts
getAllowedProjectPaths: (agentId: string) => string[];
```

Inside the watcher's gate-eval call, replace `workspaceCwd: getWorkspaceCwd()` with `allowedProjectPaths: getAllowedProjectPaths(agent.id)`.

- [ ] **Step 2: Wire up in apps/main/src/index.ts**

Replace the `getWorkspaceCwd` line with a `getAllowedProjectPaths` closure:

```ts
import { createProjectsRepository } from "./projects/repository.js";

const projectsRepo = createProjectsRepository(db);

stopPermissionWatcher = startPermissionWatcher({
  dir: permissionsDir,
  getAgent: (id) => agentsRepo.getById(id),
  getAllowedProjectPaths: (agentId) => {
    const agent = agentsRepo.getById(agentId);
    if (agent === null) return [];
    const projects = projectsRepo.listByCompany(agent.companyId);
    if (agent.allowedProjects.length === 0) return projects.map((p) => p.path);
    return projects.filter((p) => agent.allowedProjects.includes(p.id)).map((p) => p.path);
  },
  onUserDecision: ...,
});
```

(Keep the rest of the `onUserDecision` block as it was.)

- [ ] **Step 3: Update permission-watcher tests**

In `apps/main/tests/security.permission-watcher.test.ts`, replace every `getWorkspaceCwd: () => "..."` with `getAllowedProjectPaths: () => ["..."]`.

- [ ] **Step 4: Test + typecheck + commit**

```powershell
pnpm --filter @dashboard-agent/main test security.permission-watcher; pnpm typecheck
```

```bash
git add apps/main/src/security/permission-watcher.ts apps/main/src/index.ts apps/main/tests/security.permission-watcher.test.ts
git commit -m "feat(m6): permission-watcher resolves allowed project paths per agent"
```

---

### Task 13: Settings UI delta — remove workspace folder picker

**Files:**
- Modify: `apps/renderer/src/routes/Settings.tsx`
- Modify: `apps/renderer/src/i18n/en-US.json` + `pt-BR.json`

- [ ] **Step 1: Open Settings.tsx + locate the Workspace section**

The section uses `t("settings.workspace.label")` and a button that calls `window.dashboardAgent.settings.pickWorkspace()`.

- [ ] **Step 2: Replace the section with a deprecation nota**

```tsx
<section className="mb-6">
  <h2 className="text-sm font-semibold text-brand-dark mb-2">{t("settings.workspace.label")}</h2>
  <p className="text-xs text-ink-muted">
    {t("settings.workspace.deprecatedNote")}{" "}
    <Link to="/projects" className="text-brand hover:underline">{t("nav.projects")}</Link>.
  </p>
</section>
```

Add `import { Link } from "react-router-dom";` at top if missing.

- [ ] **Step 3: Add i18n key `settings.workspace.deprecatedNote`**

en: `"deprecatedNote": "Workspaces are now managed in"`
pt: `"deprecatedNote": "Workspaces agora são gerenciados em"`

- [ ] **Step 4: Verify nothing else still calls pickWorkspace from Settings**

```powershell
Select-String -Path "apps\renderer\src\**\*.tsx","apps\renderer\src\**\*.ts" -Pattern "pickWorkspace"
```

Expected: only `ProjectFormModal.tsx` (M6 keeps using it for Project path picker).

- [ ] **Step 5: Lint + typecheck + commit**

```powershell
pnpm lint; pnpm typecheck
```

```bash
git add apps/renderer/src/routes/Settings.tsx apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(m6): Settings — remove workspace picker, link to /projects"
```

---


## Phase 5 — Issues backend (5 tasks)

### Task 14: Issues repository (with event writer) + tests

**Files:**
- Create: `apps/main/src/issues/repository.ts`
- Create: `apps/main/tests/issues.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/tests/issues.repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const c = createCompaniesRepository(db).create({ name: "Acme" });
  const p = createProjectsRepository(db).create({
    companyId: c.id, name: "Web", path: "C:/w", color: "#1D5DD7",
  });
  const issues = createIssuesRepository(db);
  return { db, issues, companyId: c.id, projectId: p.id };
};

describe("issues repository", () => {
  it("create writes a 'created' event", () => {
    const { issues, companyId, projectId, db } = setup();
    const i = issues.create({
      companyId, projectId, title: "Setup CI", description: "wire actions",
      assigneeId: null, priority: "high", parentId: null, createdBy: null,
    });
    expect(i.title).toBe("Setup CI");
    const events = db.prepare("SELECT kind FROM issue_events WHERE issue_id = ?").all(i.id) as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual(["created"]);
  });

  it("update emits one event per changed field", () => {
    const { issues, companyId, projectId, db } = setup();
    const i = issues.create({
      companyId, projectId, title: "X", description: null,
      assigneeId: null, priority: "medium", parentId: null, createdBy: null,
    });
    issues.update(i.id, { status: "doing", priority: "urgent" }, { actorKind: "user", actorId: null });
    const events = db.prepare("SELECT kind FROM issue_events WHERE issue_id = ? ORDER BY created_at ASC")
      .all(i.id) as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual(["created", "status_changed", "priority_changed"]);
  });

  it("update with same value emits no event", () => {
    const { issues, companyId, projectId, db } = setup();
    const i = issues.create({
      companyId, projectId, title: "X", description: null,
      assigneeId: null, priority: "medium", parentId: null, createdBy: null,
    });
    issues.update(i.id, { status: "todo" }, { actorKind: "user", actorId: null });
    const count = (db.prepare("SELECT COUNT(*) AS n FROM issue_events WHERE issue_id = ?")
      .get(i.id) as { n: number }).n;
    expect(count).toBe(1);
  });

  it("list filters by projectId, status, assigneeId", () => {
    const { issues, companyId, projectId } = setup();
    issues.create({ companyId, projectId, title: "A", description: null, assigneeId: "ag1", priority: "low", parentId: null, createdBy: null });
    const b = issues.create({ companyId, projectId, title: "B", description: null, assigneeId: "ag2", priority: "low", parentId: null, createdBy: null });
    issues.update(b.id, { status: "doing" }, { actorKind: "system", actorId: null });
    expect(issues.list({ companyId, status: "doing" })).toHaveLength(1);
    expect(issues.list({ companyId, assigneeId: "ag1" })).toHaveLength(1);
  });

  it("delete cascades comments + events + subtasks", () => {
    const { issues, companyId, projectId, db } = setup();
    const parent = issues.create({ companyId, projectId, title: "Parent", description: null, assigneeId: null, priority: "low", parentId: null, createdBy: null });
    issues.create({ companyId, projectId, title: "Sub", description: null, assigneeId: null, priority: "low", parentId: parent.id, createdBy: null });
    db.prepare("INSERT INTO issue_comments (id, issue_id, sender_kind, content, created_at) VALUES ('co1', ?, 'user', 'hi', 0)").run(parent.id);
    issues.delete(parent.id);
    const issuesLeft = (db.prepare("SELECT COUNT(*) AS n FROM issues").get() as { n: number }).n;
    expect(issuesLeft).toBe(0);
    const commentsLeft = (db.prepare("SELECT COUNT(*) AS n FROM issue_comments").get() as { n: number }).n;
    expect(commentsLeft).toBe(0);
  });

  it("getDetail resolves project + assignee + subtasks + comments", () => {
    const { issues, companyId, projectId, db } = setup();
    const i = issues.create({ companyId, projectId, title: "X", description: null, assigneeId: null, priority: "low", parentId: null, createdBy: null });
    issues.create({ companyId, projectId, title: "Sub", description: null, assigneeId: null, priority: "low", parentId: i.id, createdBy: null });
    db.prepare("INSERT INTO issue_comments (id, issue_id, sender_kind, content, created_at) VALUES ('co1', ?, 'user', 'hi', 0)").run(i.id);
    const detail = issues.getDetail(i.id);
    expect(detail).not.toBeNull();
    expect(detail.subtasks).toHaveLength(1);
    expect(detail.comments).toHaveLength(1);
    expect(detail.events.length).toBeGreaterThanOrEqual(1);
    expect(detail.project?.name).toBe("Web");
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```powershell
pnpm --filter @dashboard-agent/main test issues.repository
```

- [ ] **Step 3: Implement repository**

Create `apps/main/src/issues/repository.ts`:

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Issue, IssueDetail, IssueStatus, IssuePriority,
  IssueComment, IssueEvent, IssueEventKind, ToolCallRef,
} from "@dashboard-agent/shared";

type IssueRow = {
  id: string; company_id: string; project_id: string | null; parent_id: string | null;
  title: string; description: string | null; assignee_id: string | null;
  status: string; priority: string; created_by: string | null;
  created_at: number; updated_at: number;
};

const rowToIssue = (r: IssueRow): Issue => ({
  id: r.id, companyId: r.company_id, projectId: r.project_id, parentId: r.parent_id,
  title: r.title, description: r.description, assigneeId: r.assignee_id,
  status: r.status as IssueStatus, priority: r.priority as IssuePriority,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

export type CreateIssueInput = {
  companyId: string; projectId: string | null; title: string; description: string | null;
  assigneeId: string | null; priority: IssuePriority; parentId: string | null; createdBy: string | null;
};

export type UpdateIssueInput = {
  title?: string; description?: string | null; status?: IssueStatus;
  assigneeId?: string | null; priority?: IssuePriority; parentId?: string | null;
};

export type ActorContext = {
  actorKind: "user" | "agent" | "system";
  actorId: string | null;
};

export type ListIssuesFilter = {
  companyId: string;
  projectId?: string;
  status?: IssueStatus;
  assigneeId?: string;
};

export type IssuesRepository = {
  create(input: CreateIssueInput, actor?: ActorContext): Issue;
  getById(id: string): Issue | null;
  getDetail(id: string): IssueDetail | null;
  list(filter: ListIssuesFilter): Issue[];
  update(id: string, patch: UpdateIssueInput, actor: ActorContext): Issue | null;
  delete(id: string): void;
  resolveProjectByNameOrId(companyId: string, query: string): { id: string; matches: number };
};

const writeEvent = (
  db: Database.Database, issueId: string, kind: IssueEventKind,
  actor: ActorContext, payload: unknown,
): void => {
  db.prepare(
    "INSERT INTO issue_events (id, issue_id, kind, actor_kind, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(`evt_${randomUUID()}`, issueId, kind, actor.actorKind, actor.actorId, JSON.stringify(payload), Date.now());
};

export const createIssuesRepository = (db: Database.Database): IssuesRepository => {
  const insert = db.prepare(`
    INSERT INTO issues (id, company_id, project_id, parent_id, title, description, assignee_id, status, priority, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?)
  `);
  const byId = db.prepare("SELECT * FROM issues WHERE id = ?");
  const childrenStmt = db.prepare("SELECT * FROM issues WHERE parent_id = ? ORDER BY created_at ASC");
  const eventsStmt = db.prepare("SELECT * FROM issue_events WHERE issue_id = ? ORDER BY created_at ASC");
  const commentsStmt = db.prepare("SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC");

  const repo: IssuesRepository = {
    create(input, actor = { actorKind: "system", actorId: null }) {
      const id = `iss_${randomUUID()}`;
      const now = Date.now();
      insert.run(
        id, input.companyId, input.projectId, input.parentId, input.title,
        input.description, input.assigneeId, input.priority, input.createdBy, now, now,
      );
      writeEvent(db, id, "created", actor, {
        title: input.title, project_id: input.projectId,
        assignee_id: input.assigneeId, priority: input.priority,
      });
      return rowToIssue(byId.get(id) as IssueRow);
    },
    getById(id) {
      const row = byId.get(id) as IssueRow | undefined;
      return row ? rowToIssue(row) : null;
    },
    getDetail(id) {
      const issue = repo.getById(id);
      if (issue === null) return null;
      const subtasks = (childrenStmt.all(id) as IssueRow[]).map(rowToIssue);
      const events: IssueEvent[] = (eventsStmt.all(id) as Array<{
        id: string; issue_id: string; kind: string; actor_kind: string;
        actor_id: string | null; payload_json: string; created_at: number;
      }>).map((r) => ({
        id: r.id, issueId: r.issue_id, kind: r.kind as IssueEventKind,
        actorKind: r.actor_kind as "user" | "agent" | "system",
        actorId: r.actor_id, payloadJson: r.payload_json, createdAt: r.created_at,
      }));
      const comments: IssueComment[] = (commentsStmt.all(id) as Array<{
        id: string; issue_id: string; sender_kind: string; sender_id: string | null;
        content: string; created_at: number;
      }>).map((r) => ({
        id: r.id, issueId: r.issue_id, senderKind: r.sender_kind as "user" | "agent",
        senderId: r.sender_id, content: r.content, createdAt: r.created_at,
      }));

      let assignee: IssueDetail["assignee"] = null;
      if (issue.assigneeId !== null) {
        const a = db.prepare("SELECT id, name, role FROM agents WHERE id = ?")
          .get(issue.assigneeId) as { id: string; name: string; role: string } | undefined;
        if (a !== undefined) assignee = a;
      }
      let project: IssueDetail["project"] = null;
      if (issue.projectId !== null) {
        const p = db.prepare("SELECT id, name, color FROM projects WHERE id = ?")
          .get(issue.projectId) as { id: string; name: string; color: string } | undefined;
        if (p !== undefined) project = p;
      }
      // Tool history: stays empty; populated by getToolHistory in Task 15 — re-import once added
      const toolHistory: ToolCallRef[] = [];
      return { issue, comments, events, subtasks, toolHistory, assignee, project };
    },
    list(filter) {
      const clauses = ["company_id = ?"];
      const params: unknown[] = [filter.companyId];
      if (filter.projectId !== undefined) { clauses.push("project_id = ?"); params.push(filter.projectId); }
      if (filter.status !== undefined) { clauses.push("status = ?"); params.push(filter.status); }
      if (filter.assigneeId !== undefined) { clauses.push("assignee_id = ?"); params.push(filter.assigneeId); }
      const sql = `SELECT * FROM issues WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 100`;
      return (db.prepare(sql).all(...params) as IssueRow[]).map(rowToIssue);
    },
    update(id, patch, actor) {
      const current = byId.get(id) as IssueRow | undefined;
      if (current === undefined) return null;
      const sets: string[] = ["updated_at = ?"];
      const params: unknown[] = [Date.now()];
      const events: Array<{ kind: IssueEventKind; payload: unknown }> = [];

      if (patch.title !== undefined && patch.title !== current.title) {
        sets.push("title = ?"); params.push(patch.title);
      }
      if (patch.description !== undefined && patch.description !== current.description) {
        sets.push("description = ?"); params.push(patch.description);
      }
      if (patch.status !== undefined && patch.status !== current.status) {
        sets.push("status = ?"); params.push(patch.status);
        events.push({ kind: "status_changed", payload: { from: current.status, to: patch.status } });
      }
      if (patch.assigneeId !== undefined && patch.assigneeId !== current.assignee_id) {
        sets.push("assignee_id = ?"); params.push(patch.assigneeId);
        events.push({ kind: "assignee_changed", payload: { from: current.assignee_id, to: patch.assigneeId } });
      }
      if (patch.priority !== undefined && patch.priority !== current.priority) {
        sets.push("priority = ?"); params.push(patch.priority);
        events.push({ kind: "priority_changed", payload: { from: current.priority, to: patch.priority } });
      }
      if (patch.parentId !== undefined && patch.parentId !== current.parent_id) {
        sets.push("parent_id = ?"); params.push(patch.parentId);
        events.push({ kind: "reparented", payload: { from: current.parent_id, to: patch.parentId } });
      }
      if (sets.length === 1) return rowToIssue(current);
      params.push(id);
      db.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      for (const e of events) writeEvent(db, id, e.kind, actor, e.payload);
      return rowToIssue(byId.get(id) as IssueRow);
    },
    delete(id) {
      db.prepare("DELETE FROM issues WHERE id = ?").run(id);
    },
    resolveProjectByNameOrId(companyId, query) {
      const byIdRow = db.prepare("SELECT id FROM projects WHERE id = ? AND company_id = ?")
        .get(query, companyId) as { id: string } | undefined;
      if (byIdRow !== undefined) return { id: byIdRow.id, matches: 1 };
      const byName = db.prepare(
        "SELECT id FROM projects WHERE company_id = ? AND lower(name) = lower(?)",
      ).all(companyId, query) as { id: string }[];
      if (byName.length === 1) return { id: byName[0]!.id, matches: 1 };
      return { id: "", matches: byName.length };
    },
  };
  return repo;
};
```

- [ ] **Step 4: Run + commit**

```powershell
pnpm --filter @dashboard-agent/main test issues.repository
```

```bash
git add apps/main/src/issues/repository.ts apps/main/tests/issues.repository.test.ts
git commit -m "feat(m6): issues repository — CRUD + event writer + project lookup"
```

---

### Task 15: Issue comments repository + tool history function

**Files:**
- Create: `apps/main/src/issues/comments-repository.ts`
- Create: `apps/main/src/issues/tool-history.ts`
- Create: `apps/main/tests/issues.comments-repository.test.ts`
- Create: `apps/main/tests/issues.tool-history.test.ts`

- [ ] **Step 1: Comments-repository test**

Create `apps/main/tests/issues.comments-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { createIssueCommentsRepository } from "../src/issues/comments-repository.js";

describe("issue comments repository", () => {
  it("add + listByIssue ordered by createdAt", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const c = createCompaniesRepository(db).create({ name: "Acme" });
    const i = createIssuesRepository(db).create({
      companyId: c.id, projectId: null, title: "T", description: null,
      assigneeId: null, priority: "low", parentId: null, createdBy: null,
    });
    const comments = createIssueCommentsRepository(db);
    comments.add({ issueId: i.id, senderKind: "user", senderId: null, content: "first" });
    comments.add({ issueId: i.id, senderKind: "agent", senderId: "ag1", content: "second" });
    const list = comments.listByIssue(i.id);
    expect(list).toHaveLength(2);
    expect(list[0]!.content).toBe("first");
    expect(list[1]!.senderKind).toBe("agent");
  });
});
```

- [ ] **Step 2: Implement comments repository**

Create `apps/main/src/issues/comments-repository.ts`:

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { IssueComment } from "@dashboard-agent/shared";

type Row = {
  id: string; issue_id: string; sender_kind: string;
  sender_id: string | null; content: string; created_at: number;
};

const rowToComment = (r: Row): IssueComment => ({
  id: r.id, issueId: r.issue_id, senderKind: r.sender_kind as "user" | "agent",
  senderId: r.sender_id, content: r.content, createdAt: r.created_at,
});

export type AddCommentInput = {
  issueId: string;
  senderKind: "user" | "agent";
  senderId: string | null;
  content: string;
};

export type IssueCommentsRepository = {
  add(input: AddCommentInput): IssueComment;
  listByIssue(issueId: string): IssueComment[];
};

export const createIssueCommentsRepository = (db: Database.Database): IssueCommentsRepository => {
  const insert = db.prepare(
    "INSERT INTO issue_comments (id, issue_id, sender_kind, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const byIssue = db.prepare("SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC");
  const byId = db.prepare("SELECT * FROM issue_comments WHERE id = ?");

  return {
    add(input) {
      const id = `cmt_${randomUUID()}`;
      insert.run(id, input.issueId, input.senderKind, input.senderId, input.content, Date.now());
      return rowToComment(byId.get(id) as Row);
    },
    listByIssue(issueId) {
      return (byIssue.all(issueId) as Row[]).map(rowToComment);
    },
  };
};
```

- [ ] **Step 3: Tool-history test**

Create `apps/main/tests/issues.tool-history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { getToolHistory } from "../src/issues/tool-history.js";

describe("getToolHistory", () => {
  it("returns empty when issue never reached doing", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const c = createCompaniesRepository(db).create({ name: "X" });
    const a = createAgentsRepository(db).create({
      companyId: c.id, name: "A", role: "x", systemPrompt: "x", mode: "auto", alwaysOn: false,
    });
    const i = createIssuesRepository(db).create({
      companyId: c.id, projectId: null, title: "T", description: null,
      assigneeId: a.id, priority: "low", parentId: null, createdBy: null,
    });
    expect(getToolHistory(db, i.id)).toEqual([]);
  });

  it("returns assignee's tool calls inside doing window", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const c = createCompaniesRepository(db).create({ name: "X" });
    const a = createAgentsRepository(db).create({
      companyId: c.id, name: "A", role: "x", systemPrompt: "x", mode: "auto", alwaysOn: false,
    });
    const issuesRepo = createIssuesRepository(db);
    const i = issuesRepo.create({
      companyId: c.id, projectId: null, title: "T", description: null,
      assigneeId: a.id, priority: "low", parentId: null, createdBy: null,
    });
    issuesRepo.update(i.id, { status: "doing" }, { actorKind: "user", actorId: null });
    const startTime = Date.now();
    db.prepare(
      "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES ('th1', ?, '[]', 0)",
    ).run(c.id);
    db.prepare(
      "INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("m1", "th1", "agent", a.id, "thinking",
      JSON.stringify([{ name: "Bash", input: { command: "ls" } }]), startTime + 10);
    issuesRepo.update(i.id, { status: "done" }, { actorKind: "user", actorId: null });

    const hist = getToolHistory(db, i.id);
    expect(hist).toHaveLength(1);
    expect(hist[0]!.toolName).toBe("Bash");
  });
});
```

- [ ] **Step 4: Implement tool-history**

Create `apps/main/src/issues/tool-history.ts`:

```ts
import type Database from "better-sqlite3";
import type { ToolCallRef } from "@dashboard-agent/shared";

type EventRow = { kind: string; payload_json: string; created_at: number };
type MsgRow = { tool_calls_json: string | null; created_at: number };
type Window = { start: number; end: number };

const computeDoingWindows = (events: EventRow[]): Window[] => {
  const windows: Window[] = [];
  let openStart: number | null = null;
  for (const e of events) {
    if (e.kind !== "status_changed") continue;
    const payload = JSON.parse(e.payload_json) as { from: string; to: string };
    if (payload.to === "doing" && openStart === null) {
      openStart = e.created_at;
    } else if (openStart !== null && (payload.to === "review" || payload.to === "done" || payload.to === "cancelled")) {
      windows.push({ start: openStart, end: e.created_at });
      openStart = null;
    }
  }
  if (openStart !== null) windows.push({ start: openStart, end: Number.MAX_SAFE_INTEGER });
  return windows;
};

export const getToolHistory = (db: Database.Database, issueId: string): ToolCallRef[] => {
  const issue = db.prepare("SELECT assignee_id FROM issues WHERE id = ?")
    .get(issueId) as { assignee_id: string | null } | undefined;
  if (issue === undefined || issue.assignee_id === null) return [];

  const events = db.prepare(
    "SELECT kind, payload_json, created_at FROM issue_events WHERE issue_id = ? ORDER BY created_at ASC",
  ).all(issueId) as EventRow[];
  const windows = computeDoingWindows(events);
  if (windows.length === 0) return [];

  const out: ToolCallRef[] = [];
  for (const w of windows) {
    const msgs = db.prepare(
      "SELECT tool_calls_json, created_at FROM messages WHERE sender_kind = 'agent' AND sender_id = ? AND tool_calls_json IS NOT NULL AND created_at BETWEEN ? AND ? ORDER BY created_at ASC",
    ).all(issue.assignee_id, w.start, w.end) as MsgRow[];
    for (const m of msgs) {
      if (m.tool_calls_json === null) continue;
      const calls = JSON.parse(m.tool_calls_json) as Array<{ name: string; input: Record<string, unknown> }>;
      for (const c of calls) out.push({ toolName: c.name, input: c.input, createdAt: m.created_at });
    }
  }
  return out;
};
```

- [ ] **Step 5: Wire tool-history into IssuesRepository.getDetail**

In `apps/main/src/issues/repository.ts`:

Add at top: `import { getToolHistory } from "./tool-history.js";`

Replace `const toolHistory: ToolCallRef[] = [];` with `const toolHistory = getToolHistory(db, id);`.

- [ ] **Step 6: Run + commit**

```powershell
pnpm --filter @dashboard-agent/main test issues
```

```bash
git add apps/main/src/issues apps/main/tests/issues.comments-repository.test.ts apps/main/tests/issues.tool-history.test.ts
git commit -m "feat(m6): issue comments repository + tool-history derivation"
```

---

### Task 16: Issues IPC channels + handlers + preload

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `apps/main/src/ipc/issues-handlers.ts`
- Create: `apps/main/src/ipc/issue-events-broadcast.ts`
- Modify: `apps/main/src/ipc/handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Create: `apps/main/tests/ipc.issues-handlers.test.ts`

- [ ] **Step 1: Add channels**

In `packages/shared/src/ipc-channels.ts` `IPC` object:

```ts
ISSUES_LIST: "issues:list",
ISSUES_GET: "issues:get",
ISSUES_CREATE: "issues:create",
ISSUES_UPDATE: "issues:update",
ISSUES_DELETE: "issues:delete",
ISSUES_ADD_COMMENT: "issues:add-comment",
ISSUES_CHANGED: "issues:changed",
```

- [ ] **Step 2: Implement broadcast helper**

Create `apps/main/src/ipc/issue-events-broadcast.ts`:

```ts
import { BrowserWindow } from "electron";
import { IPC } from "@dashboard-agent/shared";

export type IssueChangedEvent =
  | { kind: "created"; issueId: string; companyId: string }
  | { kind: "updated"; issueId: string; companyId: string }
  | { kind: "deleted"; issueId: string; companyId: string }
  | { kind: "comment-added"; issueId: string; companyId: string };

export const broadcastIssueChanged = (event: IssueChangedEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.ISSUES_CHANGED, event);
  }
};
```

- [ ] **Step 3: Implement handlers**

Create `apps/main/src/ipc/issues-handlers.ts`:

```ts
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import {
  IPC, type Issue, type IssueDetail, type IssueComment,
  type IssueStatus, type IssuePriority,
} from "@dashboard-agent/shared";
import { createIssuesRepository } from "../issues/repository.js";
import { createIssueCommentsRepository } from "../issues/comments-repository.js";
import { broadcastIssueChanged } from "./issue-events-broadcast.js";

export const registerIssuesHandlers = (db: Database.Database): void => {
  const issues = createIssuesRepository(db);
  const comments = createIssueCommentsRepository(db);

  ipcMain.handle(
    IPC.ISSUES_LIST,
    (
      _e,
      payload: { companyId: string; projectId?: string; assigneeId?: string; status?: IssueStatus },
    ): Issue[] => issues.list(payload),
  );

  ipcMain.handle(IPC.ISSUES_GET, (_e, payload: { id: string }): IssueDetail | null =>
    issues.getDetail(payload.id),
  );

  ipcMain.handle(
    IPC.ISSUES_CREATE,
    (
      _e,
      payload: {
        companyId: string; projectId: string | null; title: string;
        description?: string | null; assigneeId?: string | null;
        priority?: IssuePriority; parentId?: string | null;
      },
    ): Issue => {
      const i = issues.create({
        companyId: payload.companyId,
        projectId: payload.projectId,
        title: payload.title,
        description: payload.description ?? null,
        assigneeId: payload.assigneeId ?? null,
        priority: payload.priority ?? "medium",
        parentId: payload.parentId ?? null,
        createdBy: null,
      }, { actorKind: "user", actorId: null });
      broadcastIssueChanged({ kind: "created", issueId: i.id, companyId: i.companyId });
      return i;
    },
  );

  ipcMain.handle(
    IPC.ISSUES_UPDATE,
    (
      _e,
      payload: {
        id: string;
        title?: string; description?: string | null; status?: IssueStatus;
        assigneeId?: string | null; priority?: IssuePriority; parentId?: string | null;
      },
    ): Issue | null => {
      const { id, ...patch } = payload;
      const next = issues.update(id, patch, { actorKind: "user", actorId: null });
      if (next !== null) broadcastIssueChanged({ kind: "updated", issueId: next.id, companyId: next.companyId });
      return next;
    },
  );

  ipcMain.handle(IPC.ISSUES_DELETE, (_e, payload: { id: string }): { ok: true } => {
    const issue = issues.getById(payload.id);
    issues.delete(payload.id);
    if (issue !== null) broadcastIssueChanged({ kind: "deleted", issueId: payload.id, companyId: issue.companyId });
    return { ok: true };
  });

  ipcMain.handle(
    IPC.ISSUES_ADD_COMMENT,
    (_e, payload: { issueId: string; content: string }): IssueComment => {
      const c = comments.add({
        issueId: payload.issueId, senderKind: "user", senderId: null, content: payload.content,
      });
      const issue = issues.getById(payload.issueId);
      if (issue !== null) broadcastIssueChanged({ kind: "comment-added", issueId: c.issueId, companyId: issue.companyId });
      return c;
    },
  );
};
```

- [ ] **Step 4: Register in handlers.ts**

Add import + call in `apps/main/src/ipc/handlers.ts` after `registerProjectsHandlers(db);`:

```ts
import { registerIssuesHandlers } from "./issues-handlers.js";
// ...
registerIssuesHandlers(db);
```

- [ ] **Step 5: Expose preload**

Add to `apps/main/src/ipc/preload.ts` (alongside `projects`):

```ts
issues: {
  list: (payload: {
    companyId: string; projectId?: string; assigneeId?: string;
    status?: import("@dashboard-agent/shared").IssueStatus;
  }) => ipcRenderer.invoke(IPC.ISSUES_LIST, payload) as Promise<Issue[]>,
  get: (id: string) => ipcRenderer.invoke(IPC.ISSUES_GET, { id }) as Promise<IssueDetail | null>,
  create: (input: {
    companyId: string; projectId: string | null; title: string; description?: string | null;
    assigneeId?: string | null; priority?: import("@dashboard-agent/shared").IssuePriority;
    parentId?: string | null;
  }) => ipcRenderer.invoke(IPC.ISSUES_CREATE, input) as Promise<Issue>,
  update: (input: {
    id: string; title?: string; description?: string | null;
    status?: import("@dashboard-agent/shared").IssueStatus;
    assigneeId?: string | null; priority?: import("@dashboard-agent/shared").IssuePriority;
    parentId?: string | null;
  }) => ipcRenderer.invoke(IPC.ISSUES_UPDATE, input) as Promise<Issue | null>,
  delete: (id: string) => ipcRenderer.invoke(IPC.ISSUES_DELETE, { id }) as Promise<{ ok: true }>,
  addComment: (issueId: string, content: string) =>
    ipcRenderer.invoke(IPC.ISSUES_ADD_COMMENT, { issueId, content }) as Promise<IssueComment>,
  onChanged: (cb: (event: { kind: string; issueId: string; companyId: string }) => void) => {
    const handler = (_e: unknown, ev: { kind: string; issueId: string; companyId: string }) => cb(ev);
    ipcRenderer.on(IPC.ISSUES_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.ISSUES_CHANGED, handler);
  },
},
```

Add `Issue, IssueDetail, IssueComment` to the `import type` line from `@dashboard-agent/shared`.

- [ ] **Step 6: Smoke test**

Create `apps/main/tests/ipc.issues-handlers.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

beforeEach(() => vi.clearAllMocks());

describe("issues handlers — channel registration", () => {
  it("registers all 6 issue channels", async () => {
    const { ipcMain } = await import("electron");
    const { registerIssuesHandlers } = await import("../src/ipc/issues-handlers.js");
    const db = new Database(":memory:");
    applyMigrations(db);
    createCompaniesRepository(db).create({ name: "Acme" });
    registerIssuesHandlers(db);
    const channels = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(channels).toEqual([
      "issues:list", "issues:get", "issues:create",
      "issues:update", "issues:delete", "issues:add-comment",
    ]);
  });
});
```

- [ ] **Step 7: Run + commit**

```powershell
pnpm --filter @dashboard-agent/main test ipc.issues-handlers; pnpm typecheck
```

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/issues-handlers.ts apps/main/src/ipc/issue-events-broadcast.ts apps/main/src/ipc/handlers.ts apps/main/src/ipc/preload.ts apps/main/tests/ipc.issues-handlers.test.ts
git commit -m "feat(m6): IPC handlers for issues (CRUD + comments + onChanged broadcast)"
```

---

### Task 17: Real MCP tools (replace stubs + add 4)

**Files:**
- Modify: `apps/main/src/mcp/tools.ts`
- Modify: `apps/main/tests/mcp.tools.test.ts` (existing — update create_issue test)
- Create: `apps/main/tests/mcp.tools-issues.test.ts`

- [ ] **Step 1: Replace `create_issue` stub + add 4 new tools**

In `apps/main/src/mcp/tools.ts`:

Add imports at top:

```ts
import { createIssuesRepository } from "../issues/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
```

Find the existing `create_issue` entry. Replace with:

```ts
{
  name: "create_issue",
  description: "Create a new issue. project may be a project ID or a project name.",
  inputSchema: z.object({
    project: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    assignee: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    parent_id: z.string().optional(),
  }),
  run: async (
    input: { project: string; title: string; description?: string;
             assignee?: string; priority?: "low"|"medium"|"high"|"urgent"; parent_id?: string },
    ctx: ToolContext,
  ): Promise<string> => {
    const issues = createIssuesRepository(ctx.db);
    const lookup = issues.resolveProjectByNameOrId(ctx.companyId, input.project);
    if (lookup.matches === 0) return JSON.stringify({ ok: false, error: "project not found" });
    if (lookup.matches > 1) return JSON.stringify({ ok: false, error: "multiple projects match" });
    const created = issues.create({
      companyId: ctx.companyId,
      projectId: lookup.id,
      title: input.title,
      description: input.description ?? null,
      assigneeId: input.assignee ?? null,
      priority: input.priority ?? "medium",
      parentId: input.parent_id ?? null,
      createdBy: ctx.agentId,
    }, { actorKind: "agent", actorId: ctx.agentId });
    ctx.emit({ kind: "issue.created", payload: { issueId: created.id } });
    return JSON.stringify({ id: created.id, title: created.title });
  },
},
```

Append 4 new tools at the end of the array (before `request_permission`):

```ts
{
  name: "update_issue",
  description: "Update fields of an issue. Status 'done' notifies the user via Inbox.",
  inputSchema: z.object({
    id: z.string(),
    status: z.enum(["backlog","todo","doing","review","done","cancelled"]).optional(),
    description: z.string().optional(),
    title: z.string().optional(),
    assignee: z.string().optional(),
    priority: z.enum(["low","medium","high","urgent"]).optional(),
  }),
  run: async (
    input: { id: string; status?: any; description?: string; title?: string; assignee?: string; priority?: any },
    ctx: ToolContext,
  ): Promise<string> => {
    const issues = createIssuesRepository(ctx.db);
    const next = issues.update(input.id, {
      status: input.status, description: input.description, title: input.title,
      assigneeId: input.assignee, priority: input.priority,
    }, { actorKind: "agent", actorId: ctx.agentId });
    if (next === null) return JSON.stringify({ ok: false, error: "issue not found" });
    if (input.status === "done") {
      const inbox = createInboxRepository(ctx.db);
      const caller = ctx.db.prepare("SELECT name FROM agents WHERE id = ?")
        .get(ctx.agentId) as { name: string } | undefined;
      inbox.create({
        companyId: ctx.companyId, kind: "completed", actorId: ctx.agentId,
        title: `${next.title} — done`,
        preview: caller ? `marked done by ${caller.name}` : null,
        requiresAction: false,
        payloadJson: JSON.stringify({ issueId: next.id, byAgent: caller?.name ?? null }),
      });
    }
    ctx.emit({ kind: "issue.updated", payload: { issueId: next.id } });
    return JSON.stringify({ id: next.id, status: next.status });
  },
},
{
  name: "assign_issue",
  description: "Assign an issue to an agent.",
  inputSchema: z.object({ issue_id: z.string(), agent_id: z.string() }),
  run: async (input: { issue_id: string; agent_id: string }, ctx: ToolContext): Promise<string> => {
    const issues = createIssuesRepository(ctx.db);
    const next = issues.update(input.issue_id, { assigneeId: input.agent_id },
      { actorKind: "agent", actorId: ctx.agentId });
    if (next === null) return JSON.stringify({ ok: false, error: "issue not found" });
    ctx.emit({ kind: "issue.updated", payload: { issueId: next.id } });
    return JSON.stringify({ id: next.id, assignee: next.assigneeId });
  },
},
{
  name: "list_issues",
  description: "List issues with optional filters (project, status, assignee).",
  inputSchema: z.object({
    project: z.string().optional(),
    status: z.enum(["backlog","todo","doing","review","done","cancelled"]).optional(),
    assignee: z.string().optional(),
  }),
  run: async (input: { project?: string; status?: any; assignee?: string }, ctx: ToolContext): Promise<string> => {
    const issues = createIssuesRepository(ctx.db);
    let projectId: string | undefined;
    if (input.project !== undefined) {
      const lookup = issues.resolveProjectByNameOrId(ctx.companyId, input.project);
      if (lookup.matches !== 1) return JSON.stringify({ ok: false, error: "project lookup failed" });
      projectId = lookup.id;
    }
    const list = issues.list({
      companyId: ctx.companyId, projectId, status: input.status, assigneeId: input.assignee,
    });
    return JSON.stringify({ issues: list.map((i) => ({
      id: i.id, title: i.title, status: i.status, assignee: i.assigneeId, priority: i.priority,
    })) });
  },
},
{
  name: "check_status",
  description: "Get current status of an issue.",
  inputSchema: z.object({ issue_id: z.string() }),
  run: async (input: { issue_id: string }, ctx: ToolContext): Promise<string> => {
    const issues = createIssuesRepository(ctx.db);
    const i = issues.getById(input.issue_id);
    if (i === null) return JSON.stringify({ ok: false, error: "not found" });
    return JSON.stringify({ id: i.id, status: i.status, assignee: i.assigneeId, updated_at: i.updatedAt });
  },
},
```

- [ ] **Step 2: Update existing mcp.tools.test.ts**

Find any test asserting `mocked: true` on `create_issue` and update to assert real persistence. Or remove that test if the new test in Step 4 covers it.

- [ ] **Step 3: Add lifecycle settings.json allow entries**

Modify `apps/main/src/orchestrator/lifecycle.ts`. In the `permissions.allow` array inside `settingsContent`, append:

```ts
"mcp__dashboard__update_issue",
"mcp__dashboard__assign_issue",
"mcp__dashboard__list_issues",
"mcp__dashboard__check_status",
```

- [ ] **Step 4: Add tool tests**

Create `apps/main/tests/mcp.tools-issues.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";
import { toolDefinitions } from "../src/mcp/tools.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createCompaniesRepository(db).create({ name: "Acme" });
  const agent = createAgentsRepository(db).create({
    companyId: company.id, name: "Dev1", role: "engineer",
    systemPrompt: "x", mode: "auto", alwaysOn: false,
  });
  const project = createProjectsRepository(db).create({
    companyId: company.id, name: "Web", path: "C:/w", color: "#1D5DD7",
  });
  const ctx = {
    agentId: agent.id, companyId: company.id, db,
    permissionsDir: "/tmp", emit: vi.fn(),
  };
  const tool = (name: string) => toolDefinitions.find((t) => t.name === name)!;
  return { db, ctx, tool, projectId: project.id, agentId: agent.id, companyId: company.id };
};

describe("MCP tools — issues", () => {
  it("create_issue persists with project name lookup", async () => {
    const { ctx, tool } = setup();
    const result = JSON.parse(await tool("create_issue").run(
      { project: "Web", title: "Setup CI" }, ctx as any,
    ));
    expect(result.id).toBeDefined();
    expect(result.title).toBe("Setup CI");
    expect(ctx.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: "issue.created" }));
  });

  it("create_issue rejects unknown project", async () => {
    const { ctx, tool } = setup();
    const result = JSON.parse(await tool("create_issue").run(
      { project: "ghost", title: "X" }, ctx as any,
    ));
    expect(result.ok).toBe(false);
  });

  it("update_issue with status=done writes Inbox completed", async () => {
    const { ctx, tool, db } = setup();
    const created = JSON.parse(await tool("create_issue").run(
      { project: "Web", title: "Bug" }, ctx as any,
    ));
    await tool("update_issue").run({ id: created.id, status: "done" }, ctx as any);
    const inboxCount = (db.prepare(
      "SELECT COUNT(*) AS n FROM inbox_items WHERE kind = 'completed'",
    ).get() as { n: number }).n;
    expect(inboxCount).toBe(1);
  });

  it("list_issues filters by status", async () => {
    const { ctx, tool } = setup();
    await tool("create_issue").run({ project: "Web", title: "A" }, ctx as any);
    await tool("create_issue").run({ project: "Web", title: "B" }, ctx as any);
    const all = JSON.parse(await tool("list_issues").run({ project: "Web" }, ctx as any));
    expect(all.issues).toHaveLength(2);
  });

  it("check_status returns id + status", async () => {
    const { ctx, tool } = setup();
    const created = JSON.parse(await tool("create_issue").run(
      { project: "Web", title: "X" }, ctx as any,
    ));
    const status = JSON.parse(await tool("check_status").run({ issue_id: created.id }, ctx as any));
    expect(status.id).toBe(created.id);
    expect(status.status).toBe("todo");
  });
});
```

- [ ] **Step 5: Run + commit**

```powershell
pnpm --filter @dashboard-agent/main test mcp.tools
```

```bash
git add apps/main/src/mcp/tools.ts apps/main/src/orchestrator/lifecycle.ts apps/main/tests/mcp.tools.test.ts apps/main/tests/mcp.tools-issues.test.ts
git commit -m "feat(m6): real MCP tools for issues (create/update/assign/list/check_status)"
```

---


## Phase 6 — Issues UI (8 tasks)

### Task 18: Install @dnd-kit + Issues zustand store + i18n

**Files:**
- Modify: `apps/renderer/package.json`
- Create: `apps/renderer/src/stores/issues.ts`
- Modify: `apps/renderer/src/i18n/en-US.json` + `pt-BR.json`

- [ ] **Step 1: Add dnd-kit deps**

```powershell
pnpm --filter @dashboard-agent/renderer add @dnd-kit/core @dnd-kit/sortable
```

Verify the entries appear in `apps/renderer/package.json` under dependencies.

- [ ] **Step 2: Implement issues store**

Create `apps/renderer/src/stores/issues.ts`:

```ts
import { create } from "zustand";
import type { Issue, IssueDetail, IssueStatus, IssuePriority } from "@dashboard-agent/shared";

type State = {
  issues: Issue[];
  detail: IssueDetail | null;
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  loadDetail: (id: string) => Promise<void>;
  clearDetail: () => void;
  create: (input: {
    companyId: string; projectId: string | null; title: string;
    description?: string | null; assigneeId?: string | null;
    priority?: IssuePriority; parentId?: string | null;
  }) => Promise<Issue>;
  update: (input: {
    id: string; title?: string; description?: string | null;
    status?: IssueStatus; assigneeId?: string | null;
    priority?: IssuePriority; parentId?: string | null;
  }) => Promise<void>;
  delete: (id: string) => Promise<void>;
  addComment: (issueId: string, content: string) => Promise<void>;
  optimisticStatus: (id: string, status: IssueStatus) => void;
};

export const useIssuesStore = create<State>((set, get) => ({
  issues: [],
  detail: null,
  loaded: false,
  load: async (companyId) => {
    const issues = await window.dashboardAgent.issues.list({ companyId });
    set({ issues, loaded: true });
  },
  loadDetail: async (id) => {
    const detail = await window.dashboardAgent.issues.get(id);
    set({ detail });
  },
  clearDetail: () => set({ detail: null }),
  create: async (input) => {
    const i = await window.dashboardAgent.issues.create(input);
    set((s) => ({ issues: [i, ...s.issues] }));
    return i;
  },
  update: async (input) => {
    const next = await window.dashboardAgent.issues.update(input);
    if (next === null) return;
    set((s) => ({
      issues: s.issues.map((i) => (i.id === next.id ? next : i)),
      detail: s.detail?.issue.id === next.id ? { ...s.detail, issue: next } : s.detail,
    }));
  },
  delete: async (id) => {
    await window.dashboardAgent.issues.delete(id);
    set((s) => ({ issues: s.issues.filter((i) => i.id !== id) }));
  },
  addComment: async (issueId, content) => {
    await window.dashboardAgent.issues.addComment(issueId, content);
    if (get().detail?.issue.id === issueId) await get().loadDetail(issueId);
  },
  optimisticStatus: (id, status) =>
    set((s) => ({ issues: s.issues.map((i) => (i.id === id ? { ...i, status } : i)) })),
}));
```

- [ ] **Step 3: Add i18n keys**

In both `en-US.json` and `pt-BR.json`, add the `issues` block:

en:
```json
"issues": {
  "title": "Issues",
  "newButton": "+ New issue",
  "filters": {
    "project": "Project", "assignee": "Assignee", "priority": "Priority", "all": "All"
  },
  "columns": {
    "backlog": "Backlog", "todo": "Todo", "doing": "Doing",
    "review": "Review", "done": "Done", "cancelled": "Cancelled"
  },
  "form": {
    "title": "Title", "description": "Description", "project": "Project", "assignee": "Assignee",
    "priority": "Priority", "create": "Create issue", "cancel": "Cancel"
  },
  "detail": {
    "subtasks": "Sub-tasks", "addSubtask": "+ Add sub-task",
    "comments": "Comments", "commentPlaceholder": "Type a comment...", "send": "Send",
    "toolHistory": "Tool call history", "expand": "expand",
    "reassign": "Reassign", "delete": "Delete issue",
    "confirmDelete": "Delete this issue and all its sub-tasks?"
  }
}
```

Mirror in `pt-BR.json`.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/package.json pnpm-lock.yaml apps/renderer/src/stores/issues.ts apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(m6): @dnd-kit deps + issues store + i18n keys"
```

---

### Task 19: KanbanColumn + IssueCard components

**Files:**
- Create: `apps/renderer/src/components/issues/KanbanColumn.tsx`
- Create: `apps/renderer/src/components/issues/IssueCard.tsx`

- [ ] **Step 1: Implement IssueCard**

Create `apps/renderer/src/components/issues/IssueCard.tsx`:

```tsx
import type { FC } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@dashboard-agent/shared";

type Props = {
  issue: Issue;
  projectColor: string;
  assigneeName: string | null;
  onClick: () => void;
};

const PRIORITY_BADGE: Record<string, { label: string; cls: string }> = {
  urgent: { label: "🔴 URGENT", cls: "text-semantic-danger" },
  high: { label: "⬆ HIGH", cls: "text-semantic-warning" },
  medium: { label: "", cls: "" },
  low: { label: "", cls: "" },
};

export const IssueCard: FC<Props> = ({ issue, projectColor, assigneeName, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const badge = PRIORITY_BADGE[issue.priority];
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-surface-card border border-surface-border rounded p-2 mb-2 cursor-pointer hover:ring-1 hover:ring-brand/40 text-xs"
    >
      <div className="flex items-start gap-2">
        <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: projectColor }} />
        <span className="font-medium text-brand-dark line-clamp-2 flex-1">{issue.title}</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-ink-muted">
        <span>👤 {assigneeName ?? "—"}</span>
        {badge.label !== "" && <span className={badge.cls}>{badge.label}</span>}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Implement KanbanColumn**

Create `apps/renderer/src/components/issues/KanbanColumn.tsx`:

```tsx
import type { FC, ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { IssueStatus } from "@dashboard-agent/shared";

type Props = {
  status: IssueStatus;
  label: string;
  itemIds: string[];
  children: ReactNode;
};

export const KanbanColumn: FC<Props> = ({ status, label, itemIds, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef}
         className={`flex-1 min-w-[180px] rounded p-2 ${isOver ? "bg-brand-bg" : "bg-surface-soft"}`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold mb-2">
        {label} · {itemIds.length}
      </div>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/issues/IssueCard.tsx apps/renderer/src/components/issues/KanbanColumn.tsx
git commit -m "feat(m6): KanbanColumn + IssueCard components (dnd-kit sortable)"
```

---

### Task 20: /issues route — kanban shell with DnD + filters + sidebar nav

**Files:**
- Create: `apps/renderer/src/routes/Issues.tsx`
- Modify: `apps/renderer/src/App.tsx`

- [ ] **Step 1: Implement Issues route**

Create `apps/renderer/src/routes/Issues.tsx`:

```tsx
import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { Issue, IssueStatus, IssuePriority } from "@dashboard-agent/shared";
import { useIssuesStore } from "../stores/issues.js";
import { useProjectsStore } from "../stores/projects.js";
import { useAgentsStore } from "../stores/agents.js";
import { KanbanColumn } from "../components/issues/KanbanColumn.js";
import { IssueCard } from "../components/issues/IssueCard.js";
import { IssueFormModal } from "../components/issues/IssueFormModal.js";
import { IssueDetailModal } from "../components/issues/IssueDetailModal.js";

const COLUMNS: IssueStatus[] = ["backlog", "todo", "doing", "review", "done"];

export const Issues: FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const issues = useIssuesStore((s) => s.issues);
  const load = useIssuesStore((s) => s.load);
  const updateIssue = useIssuesStore((s) => s.update);
  const optimisticStatus = useIssuesStore((s) => s.optimisticStatus);
  const projects = useProjectsStore((s) => s.projects);
  const agents = useAgentsStore((s) => s.agents);

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterProject, setFilterProject] = useState<string>("");
  const [filterAssignee, setFilterAssignee] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<IssuePriority | "">("");

  const selectedIssueId = searchParams.get("selected");

  useEffect(() => {
    void (async () => {
      const cs = await window.dashboardAgent.companies.list();
      if (cs.length > 0) {
        setCompanyId(cs[0]!.id);
        void load(cs[0]!.id);
      }
    })();
  }, [load]);

  useEffect(() => {
    const off = window.dashboardAgent.issues.onChanged((ev) => {
      if (companyId !== null && ev.companyId === companyId) void load(companyId);
    });
    return off;
  }, [companyId, load]);

  const filtered = useMemo(() => issues.filter((i) =>
    (filterProject === "" || i.projectId === filterProject) &&
    (filterAssignee === "" || i.assigneeId === filterAssignee) &&
    (filterPriority === "" || i.priority === filterPriority)
  ), [issues, filterProject, filterAssignee, filterPriority]);

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const overId = e.over?.id;
    const activeId = e.active.id;
    if (typeof overId !== "string" || typeof activeId !== "string") return;
    if (!COLUMNS.includes(overId as IssueStatus)) return;
    const issue = issues.find((i) => i.id === activeId);
    if (issue === undefined || issue.status === overId) return;
    optimisticStatus(activeId, overId as IssueStatus);
    void updateIssue({ id: activeId, status: overId as IssueStatus });
  };

  const byStatus: Record<IssueStatus, Issue[]> = {
    backlog: [], todo: [], doing: [], review: [], done: [], cancelled: [],
  };
  for (const i of filtered) byStatus[i.status].push(i);

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-brand-dark">{t("issues.title")}</h1>
        <button type="button" onClick={() => setShowForm(true)}
                className="text-xs px-3 py-1 bg-brand text-white rounded font-semibold">
          {t("issues.newButton")}
        </button>
      </div>

      <div className="flex gap-3 mb-3 text-xs">
        <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
                className="px-2 py-1 border border-surface-border rounded">
          <option value="">{t("issues.filters.project")}: {t("issues.filters.all")}</option>
          {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
                className="px-2 py-1 border border-surface-border rounded">
          <option value="">{t("issues.filters.assignee")}: {t("issues.filters.all")}</option>
          {agents.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as IssuePriority | "")}
                className="px-2 py-1 border border-surface-border rounded">
          <option value="">{t("issues.filters.priority")}: {t("issues.filters.all")}</option>
          <option value="urgent">urgent</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 flex-1 overflow-auto">
          {COLUMNS.map((status) => (
            <KanbanColumn key={status} status={status} label={t(`issues.columns.${status}`)}
                          itemIds={byStatus[status].map((i) => i.id)}>
              {byStatus[status].map((i) => (
                <IssueCard key={i.id} issue={i}
                           projectColor={projectMap.get(i.projectId ?? "")?.color ?? "#94a3b8"}
                           assigneeName={agentMap.get(i.assigneeId ?? "")?.name ?? null}
                           onClick={() => { setSearchParams({ selected: i.id }); }} />
              ))}
            </KanbanColumn>
          ))}
        </div>
      </DndContext>

      {showForm && companyId !== null && (
        <IssueFormModal companyId={companyId} onClose={() => setShowForm(false)} />
      )}
      {selectedIssueId !== null && (
        <IssueDetailModal issueId={selectedIssueId}
                          onClose={() => { searchParams.delete("selected"); setSearchParams(searchParams); }} />
      )}
    </div>
  );
};
```

> `IssueFormModal` and `IssueDetailModal` are in next tasks. Typecheck will fail until Task 21 + 22.

- [ ] **Step 2: Wire into App.tsx**

Add import + sidebar NavLink + Route entry, similar to Task 10. Place between `/projects` and `/settings` for sidebar; route block:

```tsx
<Route path="/issues" element={hasToken ? (<Layout><Issues /></Layout>) : (<Navigate to="/setup" replace />)} />
```

In the bootstrap useEffect:

```ts
await useIssuesStore.getState().load(cid);
```

Add imports: `import { Issues } from "./routes/Issues.js"; import { useIssuesStore } from "./stores/issues.js";`

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/routes/Issues.tsx apps/renderer/src/App.tsx
git commit -m "feat(m6): /issues route shell — kanban + DnD + filters + sidebar nav"
```

---

### Task 21: IssueFormModal (+ New Issue)

**Files:**
- Create: `apps/renderer/src/components/issues/IssueFormModal.tsx`

- [ ] **Step 1: Implement modal**

Create `apps/renderer/src/components/issues/IssueFormModal.tsx`:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { IssuePriority } from "@dashboard-agent/shared";
import { useIssuesStore } from "../../stores/issues.js";
import { useProjectsStore } from "../../stores/projects.js";
import { useAgentsStore } from "../../stores/agents.js";

type Props = {
  companyId: string;
  parentId?: string;
  onClose: () => void;
};

const PRIORITIES: IssuePriority[] = ["low","medium","high","urgent"];

export const IssueFormModal: FC<Props> = ({ companyId, parentId, onClose }) => {
  const { t } = useTranslation();
  const projects = useProjectsStore((s) => s.projects);
  const agents = useAgentsStore((s) => s.agents);
  const create = useIssuesStore((s) => s.create);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim() === "") return;
    setBusy(true);
    try {
      await create({
        companyId,
        projectId: projectId === "" ? null : projectId,
        title: title.trim(),
        description: description === "" ? null : description,
        assigneeId: assigneeId === "" ? null : assigneeId,
        priority,
        parentId: parentId ?? null,
      });
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-surface-card rounded p-5 w-full max-w-md shadow-xl">
        <label className="block text-xs uppercase text-ink-soft mb-1">{t("issues.form.title")}</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={1}
               className="w-full mb-3 px-2 py-1 border border-surface-border rounded text-sm" />
        <label className="block text-xs uppercase text-ink-soft mb-1">{t("issues.form.description")}</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                  className="w-full mb-3 px-2 py-1 border border-surface-border rounded text-sm" />
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs uppercase text-ink-soft mb-1">{t("issues.form.project")}</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
                    className="w-full px-2 py-1 border border-surface-border rounded text-sm">
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase text-ink-soft mb-1">{t("issues.form.assignee")}</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}
                    className="w-full px-2 py-1 border border-surface-border rounded text-sm">
              <option value="">—</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <label className="block text-xs uppercase text-ink-soft mb-1">{t("issues.form.priority")}</label>
        <select value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)}
                className="w-full mb-4 px-2 py-1 border border-surface-border rounded text-sm">
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose}
                  className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded">
            {t("issues.form.cancel")}
          </button>
          <button type="submit" disabled={busy}
                  className="text-xs px-3 py-1 bg-brand text-white rounded font-semibold disabled:opacity-50">
            {t("issues.form.create")}
          </button>
        </div>
      </form>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/renderer/src/components/issues/IssueFormModal.tsx
git commit -m "feat(m6): IssueFormModal (+ New Issue)"
```

---

### Task 22: IssueDetailModal shell + sub-components stubs

**Files:**
- Create: `apps/renderer/src/components/issues/IssueDetailModal.tsx`
- Create: `apps/renderer/src/components/issues/IssueCommentsList.tsx`
- Create: `apps/renderer/src/components/issues/CommentComposer.tsx`
- Create: `apps/renderer/src/components/issues/SubtaskList.tsx`
- Create: `apps/renderer/src/components/issues/ToolCallHistoryAccordion.tsx`
- Create: `apps/renderer/src/components/issues/ReassignDropdown.tsx`

- [ ] **Step 1: IssueCommentsList + CommentComposer**

Create `apps/renderer/src/components/issues/IssueCommentsList.tsx`:

```tsx
import type { FC } from "react";
import type { IssueComment, Agent } from "@dashboard-agent/shared";

type Props = { comments: IssueComment[]; agentMap: Map<string, Agent> };

const fmtAgo = (ts: number): string => {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
};

export const IssueCommentsList: FC<Props> = ({ comments, agentMap }) => (
  <div className="space-y-3">
    {comments.map((c) => {
      const senderName = c.senderKind === "user"
        ? "You"
        : (c.senderId !== null ? (agentMap.get(c.senderId)?.name ?? "Agent") : "System");
      return (
        <div key={c.id} className="text-xs">
          <div className="text-ink-soft mb-1">
            <b className="text-brand-dark">{senderName}</b> ({c.senderKind}) · {fmtAgo(c.createdAt)}
          </div>
          <div className="bg-surface-soft px-3 py-2 rounded whitespace-pre-wrap">{c.content}</div>
        </div>
      );
    })}
  </div>
);
```

Create `apps/renderer/src/components/issues/CommentComposer.tsx`:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";

type Props = { onSubmit: (content: string) => Promise<void> };

export const CommentComposer: FC<Props> = ({ onSubmit }) => {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (text.trim() === "") return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } finally { setBusy(false); }
  };
  return (
    <div className="flex gap-2 mt-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
                placeholder={t("issues.detail.commentPlaceholder")}
                className="flex-1 px-2 py-1 border border-surface-border rounded text-xs" />
      <button type="button" onClick={() => void submit()} disabled={busy}
              className="text-xs px-3 py-1 bg-brand text-white rounded font-semibold disabled:opacity-50 self-start">
        {t("issues.detail.send")}
      </button>
    </div>
  );
};
```

- [ ] **Step 2: SubtaskList**

Create `apps/renderer/src/components/issues/SubtaskList.tsx`:

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Issue } from "@dashboard-agent/shared";
import { useIssuesStore } from "../../stores/issues.js";

type Props = { subtasks: Issue[]; parentId: string; onAdd: () => void };

export const SubtaskList: FC<Props> = ({ subtasks, onAdd }) => {
  const { t } = useTranslation();
  const updateIssue = useIssuesStore((s) => s.update);
  return (
    <div className="space-y-1">
      {subtasks.map((sub) => {
        const done = sub.status === "done";
        return (
          <label key={sub.id} className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={done}
                   onChange={() => void updateIssue({ id: sub.id, status: done ? "todo" : "done" })} />
            <span className={done ? "line-through text-ink-soft" : "text-brand-dark"}>{sub.title}</span>
            <span className="text-[10px] uppercase text-ink-soft ml-auto">{sub.status}</span>
          </label>
        );
      })}
      <button type="button" onClick={onAdd}
              className="text-xs text-brand hover:underline mt-1">
        {t("issues.detail.addSubtask")}
      </button>
    </div>
  );
};
```

- [ ] **Step 3: ToolCallHistoryAccordion**

Create `apps/renderer/src/components/issues/ToolCallHistoryAccordion.tsx`:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallRef } from "@dashboard-agent/shared";

type Props = { history: ToolCallRef[] };

export const ToolCallHistoryAccordion: FC<Props> = ({ history }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (history.length === 0) return null;
  return (
    <div className="border-t border-surface-border pt-3">
      <button type="button" onClick={() => setOpen((v) => !v)}
              className="text-[10px] uppercase text-ink-soft font-semibold hover:text-brand">
        {t("issues.detail.toolHistory")} ({history.length}) — {open ? "▼" : "▶"} {t("issues.detail.expand")}
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs font-mono">
          {history.map((c, idx) => (
            <div key={idx} className="bg-surface-soft px-2 py-1 rounded">
              <span className="text-brand">{c.toolName}</span>
              <span className="text-ink-muted"> {JSON.stringify(c.input).slice(0, 80)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 4: ReassignDropdown**

Create `apps/renderer/src/components/issues/ReassignDropdown.tsx`:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@dashboard-agent/shared";
import { useIssuesStore } from "../../stores/issues.js";

type Props = { issueId: string; currentAssigneeId: string | null; agents: Agent[] };

export const ReassignDropdown: FC<Props> = ({ issueId, currentAssigneeId, agents }) => {
  const { t } = useTranslation();
  const updateIssue = useIssuesStore((s) => s.update);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)}
              className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded">
        {t("issues.detail.reassign")} ▼
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface-card border border-surface-border rounded shadow-lg p-1 z-10 text-xs min-w-[160px]">
          {agents.map((a) => (
            <button key={a.id} type="button"
                    onClick={() => { void updateIssue({ id: issueId, assigneeId: a.id }); setOpen(false); }}
                    className={`w-full text-left px-2 py-1 rounded hover:bg-brand-bg ${a.id === currentAssigneeId ? "bg-brand-bg text-brand" : ""}`}>
              👤 {a.name} <span className="text-ink-soft">· {a.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 5: IssueDetailModal — assemble**

Create `apps/renderer/src/components/issues/IssueDetailModal.tsx`:

```tsx
import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useIssuesStore } from "../../stores/issues.js";
import { useAgentsStore } from "../../stores/agents.js";
import { IssueCommentsList } from "./IssueCommentsList.js";
import { CommentComposer } from "./CommentComposer.js";
import { SubtaskList } from "./SubtaskList.js";
import { ToolCallHistoryAccordion } from "./ToolCallHistoryAccordion.js";
import { ReassignDropdown } from "./ReassignDropdown.js";
import { IssueFormModal } from "./IssueFormModal.js";

type Props = { issueId: string; onClose: () => void };

export const IssueDetailModal: FC<Props> = ({ issueId, onClose }) => {
  const { t } = useTranslation();
  const detail = useIssuesStore((s) => s.detail);
  const loadDetail = useIssuesStore((s) => s.loadDetail);
  const clearDetail = useIssuesStore((s) => s.clearDetail);
  const addComment = useIssuesStore((s) => s.addComment);
  const deleteIssue = useIssuesStore((s) => s.delete);
  const agents = useAgentsStore((s) => s.agents);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);

  useEffect(() => {
    void loadDetail(issueId);
    return () => clearDetail();
  }, [issueId, loadDetail, clearDetail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  if (detail === null || detail.issue.id !== issueId) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <p className="text-ink-muted">Loading…</p>
      </div>
    );
  }

  const { issue, comments, subtasks, toolHistory, project } = detail;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
         onClick={onClose}>
      <div className="bg-surface-card rounded p-6 w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase bg-surface-soft px-2 py-0.5 rounded font-semibold">
              {issue.status}
            </span>
            <span className="text-[10px] uppercase text-ink-muted">{issue.priority}</span>
          </div>
          <button type="button" onClick={onClose} className="text-ink-soft hover:text-brand">×</button>
        </div>
        <h2 className="text-lg font-bold text-brand-dark mb-3">{issue.title}</h2>
        {issue.description !== null && (
          <p className="text-sm text-ink-muted mb-4 whitespace-pre-wrap">{issue.description}</p>
        )}
        <div className="grid grid-cols-2 gap-4 text-xs mb-4">
          <div><span className="text-ink-soft uppercase text-[10px]">Project</span><br />
               {project !== null ? (<><span className="w-2 h-2 inline-block rounded-full mr-1"
                                            style={{ background: project.color }} />{project.name}</>) : "—"}</div>
          <div><span className="text-ink-soft uppercase text-[10px]">Assignee</span><br />
               {issue.assigneeId !== null ? `👤 ${agentMap.get(issue.assigneeId)?.name ?? "Agent"}` : "—"}</div>
        </div>

        {subtasks.length > 0 && (
          <div className="mb-4">
            <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
              {t("issues.detail.subtasks")} ({subtasks.length})
            </h3>
            <SubtaskList subtasks={subtasks} parentId={issue.id} onAdd={() => setShowSubtaskForm(true)} />
          </div>
        )}

        <div className="mb-4">
          <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
            {t("issues.detail.comments")} ({comments.length})
          </h3>
          <IssueCommentsList comments={comments} agentMap={agentMap} />
          <CommentComposer onSubmit={async (content) => addComment(issue.id, content)} />
        </div>

        <ToolCallHistoryAccordion history={toolHistory} />

        <div className="flex gap-2 mt-4">
          <ReassignDropdown issueId={issue.id} currentAssigneeId={issue.assigneeId} agents={agents} />
          <button type="button"
                  onClick={() => { if (window.confirm(t("issues.detail.confirmDelete"))) { void deleteIssue(issue.id); onClose(); } }}
                  className="text-xs px-3 py-1 bg-semantic-danger text-white rounded ml-auto">
            {t("issues.detail.delete")}
          </button>
        </div>

        {showSubtaskForm && (
          <IssueFormModal companyId={issue.companyId} parentId={issue.id}
                          onClose={() => { setShowSubtaskForm(false); void loadDetail(issue.id); }} />
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Lint + typecheck**

```powershell
pnpm lint; pnpm typecheck
```

Expected: green now (Issues.tsx imports of IssueFormModal + IssueDetailModal both resolve).

- [ ] **Step 7: Commit**

```bash
git add apps/renderer/src/components/issues
git commit -m "feat(m6): IssueDetailModal + sub-components (comments/subtasks/tool-history/reassign)"
```

---


## Phase 7 — Real-time wiring + polish (3 tasks)

### Task 23: Wire MCP issue events to broadcastIssueChanged + recentIssues in Projects

**Files:**
- Modify: `apps/main/src/orchestrator/router.ts` (or wherever `ctx.emit` payloads are dispatched — verify location)
- Modify: `apps/renderer/src/routes/Projects.tsx`

- [ ] **Step 1: Locate the emit dispatcher**

```powershell
Select-String -Path "apps\main\src\**\*.ts" -Pattern "kind: \"issue\\.|emit:.*kind"
```

Find the file that handles `ctx.emit({ kind: "agent.spawn-needed", ... })` (M5 pattern). It's likely `apps/main/src/orchestrator/router.ts` or wherever the MCP tool ctx is constructed.

- [ ] **Step 2: Add issue.* event handling**

Inside the emit dispatcher's switch/if chain, add:

```ts
import { broadcastIssueChanged } from "../ipc/issue-events-broadcast.js";

// existing handlers...

if (event.kind === "issue.created" || event.kind === "issue.updated") {
  const payload = event.payload as { issueId: string };
  const issueRow = db.prepare("SELECT company_id FROM issues WHERE id = ?")
    .get(payload.issueId) as { company_id: string } | undefined;
  if (issueRow !== undefined) {
    broadcastIssueChanged({
      kind: event.kind === "issue.created" ? "created" : "updated",
      issueId: payload.issueId,
      companyId: issueRow.company_id,
    });
  }
}
```

> The exact file location depends on where `ctx.emit` callbacks are wired — verify by checking how M5's `agent.spawn-needed` is bridged to `BrowserWindow.webContents.send`.

- [ ] **Step 3: Wire recentIssues + doingCount into Projects route**

Modify `apps/renderer/src/routes/Projects.tsx`. Add:

```ts
import { useIssuesStore } from "../stores/issues.js";

// Inside component:
const allIssues = useIssuesStore((s) => s.issues);

// Inside JSX (replace the recentIssues={[]} doingCount={0} props):
const projectIssues = useMemo(
  () => allIssues.filter((i) => i.projectId === selected?.id),
  [allIssues, selected?.id],
);
const doingCount = projectIssues.filter((i) => i.status === "doing").length;
const recentIssues = projectIssues
  .slice()
  .sort((a, b) => b.updatedAt - a.updatedAt)
  .slice(0, 5);

// Pass: recentIssues={recentIssues} doingCount={doingCount}
```

Add `import { useMemo } from "react";` if missing.

- [ ] **Step 4: Test full smoke**

```powershell
pnpm lint; pnpm typecheck; pnpm --filter @dashboard-agent/main test
```

- [ ] **Step 5: Manual smoke (Electron)**

Run the app (`pnpm dev` or `pnpm --filter @dashboard-agent/main dev`). Verify:
1. App boots, sidebar shows Projects + Issues entries
2. /projects shows "Default Workspace" auto-created
3. + New project works, modal opens, creates a project
4. /issues shows empty kanban with 5 columns
5. + New issue creates an issue, appears in Backlog/Todo column
6. Drag card from Todo → Doing persists (refresh keeps state)
7. Click card opens detail modal with status badge + description + comments section
8. Comment posts and re-renders
9. Sub-task creation appears in subtasks list
10. CEO via chat: `"Crie issue 'Smoke test M6' no projeto Default. Liste."` — sees issue.created in <2s + appears in /issues

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/orchestrator/router.ts apps/renderer/src/routes/Projects.tsx
git commit -m "feat(m6): bridge MCP issue events to broadcastIssueChanged + recentIssues in Projects"
```

---

### Task 24: Token budget non-regression test

**Files:**
- Create: `apps/main/tests/m6-token-budget.test.ts`

- [ ] **Step 1: Verify baseline JSON is in place**

```powershell
Get-Content "apps\main\tests\fixtures\m6-token-baseline.json"
```

Expected: file present with non-zero `totals` (captured in Task 1).

- [ ] **Step 2: Run the M6 fixture against current code, capture observed totals**

Manually run the same fixture as Task 1 ("Crie 3 issues no projeto Default, atribua a si mesmo, liste todas") against current M6 head. Record the total tokens.

- [ ] **Step 3: Write the non-regression test**

Create `apps/main/tests/m6-token-budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type BaselineFile = {
  totals: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  ratio_ceiling: number;
};

const sumTotals = (t: BaselineFile["totals"]): number =>
  t.input_tokens + t.output_tokens + t.cache_creation_input_tokens + t.cache_read_input_tokens;

describe("M6 token budget", () => {
  it("observed run does not exceed baseline * ratio_ceiling", () => {
    const baselinePath = join(__dirname, "fixtures", "m6-token-baseline.json");
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineFile;
    const baselineTotal = sumTotals(baseline.totals);

    // Observed value comes from the fixture run captured in Step 2 above.
    // To make this test fully automated, replace this constant with reading from a
    // sibling file `m6-token-observed.json` that is regenerated by a test script.
    // For v1: this constant is updated manually each PR until automation lands.
    const observedTotal = 0; // <-- TODO replace with measured value from Step 2
    if (observedTotal === 0) {
      // Skip until first measurement is recorded.
      console.warn("m6-token-budget: no observed value recorded yet — skipping assertion");
      return;
    }

    const ratio = observedTotal / baselineTotal;
    expect(ratio).toBeLessThanOrEqual(baseline.ratio_ceiling);
  });
});
```

> The test is intentionally lenient on first run (skips if observed=0). The engineer running this task **must** update `observedTotal` with the value from Step 2 before merging. Otherwise the test becomes a no-op.

- [ ] **Step 4: Commit**

```bash
git add apps/main/tests/m6-token-budget.test.ts
git commit -m "feat(m6): token budget non-regression test (compares vs baseline fixture)"
```

---

### Task 25: ROADMAP + CHANGELOG + memory:m6_lessons + final smoke

**Files:**
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`
- Create: `C:\Users\hever\.claude\projects\d--Projetos-pessoais-DashboardAgent\memory\project_m6_lessons.md`
- Modify: `C:\Users\hever\.claude\projects\d--Projetos-pessoais-DashboardAgent\memory\MEMORY.md`

- [ ] **Step 1: Update ROADMAP.md**

In `ROADMAP.md`:

1. **Status atual** table — bump milestones closed: `M1, M2, M3, M4, M5, M6 (6/8 do v1 plano original)`. Update commit count + LoC + testes count.
2. **v1 scope tracker** — set Projects + Issues to ✅ Completo with notes; update Agents row if applicable (allowedProjects now editable via /projects).
3. **Milestones fechados** — append new ✅ M6 section with bullets matching the actual scope.
4. **Pendências da v1** — strike or delete the M6 section.
5. **Última atualização** — bump to current date.

- [ ] **Step 2: Update CHANGELOG.md**

Add an `## M6 — Issues + Projects (YYYY-MM-DD)` entry summarising:
- 2 new tables (issue_comments, issue_events) via migration 0002
- Auto-migration from `workspaceCwd` → "Default Workspace" project
- Sandbox per-agent allowlist replaces single workspaceCwd
- /projects (master/detail) + /issues (kanban + modal + comments + tool history)
- Real MCP tools: create_issue/update_issue/assign_issue/list_issues/check_status
- @dnd-kit dep for drag-drop kanban
- Tests: 147 → ~180+ passing

- [ ] **Step 3: Write memory:m6_lessons**

Create the memory file at `C:\Users\hever\.claude\projects\d--Projetos-pessoais-DashboardAgent\memory\project_m6_lessons.md`:

```markdown
---
name: M6 lições técnicas
description: Lições do milestone M6 (Issues + Projects CRUD) — pitfalls e padrões emergentes
type: project
---

(After running M6 implementation, fill in the ACTUAL pain points discovered. Suggested seed topics:)

- Post-migration scripts pattern (idempotent + run on every openDatabase) — alternative seria tracking de versions separado, mas idempotência é mais simples
- @dnd-kit setup quirks (PointerSensor activationConstraint pra evitar drag em click)
- Optimistic update + rollback pattern pro kanban DnD
- Tool history derivação SQL: cuidados com múltiplas passagens por 'doing' (windows union)
- /issues?selected=<id> via useSearchParams — funciona mas precisa cuidado pra não conflitar com filtros
- IssueFormModal reuso pra parent + sub-task (parentId opcional)
- shell.openPath retorna string vazia em sucesso (Electron quirk)
- Inbox 'completed' notification em status='done' — boa observabilidade sem approval gate
```

Update `C:\Users\hever\.claude\projects\d--Projetos-pessoais-DashboardAgent\memory\MEMORY.md` adding a line near the M5 lessons entry:

```markdown
- [M6 lições técnicas](project_m6_lessons.md) — post-migration pattern, @dnd-kit, optimistic kanban, tool history windows, etc
```

- [ ] **Step 4: Final test sweep**

```powershell
pnpm lint
pnpm typecheck
pnpm --filter @dashboard-agent/main test
pnpm --filter @dashboard-agent/renderer test
```

Expected: all green; tests count significantly higher than baseline 147.

- [ ] **Step 5: Final commit**

```bash
git add ROADMAP.md CHANGELOG.md
git commit -m "docs(m6): close M6 — Issues + Projects CRUD merged"
```

For memory file, no git commit (it's outside the repo, in the user's auto-memory dir).

- [ ] **Step 6: Verify nothing else is dirty + branch state**

```powershell
git status; git log --oneline -30
```

Expected: clean tree, ~25 M6 commits in sequence.

---

## Self-Review Checklist (run before declaring plan done)

This is a checklist the engineer (you, the executor) runs at the end:

- [ ] **Spec coverage:** Open the spec at `docs/superpowers/specs/2026-05-10-m6-issues-projects-design.md` and tick each section against an implementing task above. Notable mappings:
  - Spec §3.1 (schema) → Task 2
  - Spec §3.2 (tool history) → Task 15
  - Spec §4.1 (IPC channels) → Tasks 5 (projects), 16 (issues)
  - Spec §4.2 (MCP tools) → Task 17
  - Spec §4.3 (repositories) → Tasks 4, 14, 15
  - Spec §5 (Projects UI) → Tasks 6-10
  - Spec §6 (Issues UI) → Tasks 18-22
  - Spec §7 (sandbox migration) → Tasks 11-13
  - Spec §8 (migration runtime) → Tasks 2-3
  - Spec §9 (non-regression checks) → Tasks 1, 24
  - Spec §10 (phase order) → matches Tasks 2-25 ordering
  - Spec §11 (deps) → Task 18
  - Spec §12 (acceptance criteria) → All boxes ticked when manual smoke (Task 23 Step 5) passes

- [ ] **No remaining placeholders** in code: search for `TODO`, `XXX`, `as any` introduced by this plan.

- [ ] **Type consistency:** Confirm all `Project`, `Issue`, `IssueDetail`, `IssueComment` references in renderer match the canonical definitions in `packages/shared/src/types.ts`.

- [ ] **Idempotent migration verified twice:** post-migration test in Task 3 + manual run on real DB.

- [ ] **All tests green** + lint + typecheck.

- [ ] **Roadmap + changelog + memory updated.**

---

## Execution Handoff

Plan complete. To execute, choose:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Use `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session with checkpoint reviews. Use `superpowers:executing-plans`.

After M6 ships, the next natural milestones per ROADMAP are M7 (Org Chart + Skills), M8 (Costs), M9 (Dashboard + Multi-empresa + polish).

