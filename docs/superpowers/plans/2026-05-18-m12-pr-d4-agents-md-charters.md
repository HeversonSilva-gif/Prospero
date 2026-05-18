# M12 PR-D4 — Charters in `AGENTS.md` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `AGENTS.md` import/export so the file also carries the company's **roles and their charters** — making a whole company a single, self-contained, versionable file.

**Architecture:** The M9 PR-F.2.2 `AGENTS.md` machinery (`apps/main/src/agents-md/` — gray-matter + zod) gains a `roles` array in the YAML front-matter, each role with an optional `charter` string. Export collects the roles used by the company's live agents and reads each charter from disk; import creates any role not already present (writing its charter to disk) before wiring agents. Old `AGENTS.md` files without `roles` still parse — the field is optional.

**Tech Stack:** Electron + better-sqlite3, TypeScript, zod, gray-matter (js-yaml), React, vitest.

**Spec:** `docs/m12-agent-org-definition-layer.md` §4.4(b).

**Design decision — charters live in the YAML front-matter, not the markdown body.** Each role carries a `charter` string field. js-yaml (used by gray-matter) emits a multi-line string as a readable block scalar (`charter: |`) and parses it back losslessly. This reuses the *entire* existing gray-matter + zod parse/serialize path — no new body-section parser, no new delimiter convention. The whole company stays in one zod-validated structure.

**Other notes:**
- **Roles are name-unique** (`role_templates.name` is `UNIQUE`). Import is additive: a role whose name already exists is reused (skipped), never overwritten — same policy as projects (keyed by path) and agents (keyed by name).
- Roles for export are collected by `agent.templateId` (the reliable role-id field), not `agent.role` (which is inconsistently an id or a name across hire paths).

**Targeted test runs:** `pnpm --filter @prospero/main exec vitest run <file>` / `pnpm --filter @prospero/renderer exec vitest run <file>`. Full suite at the end: `pnpm test`.

---

## File Structure

**Modified:**
- `apps/main/src/agents-md/schema.ts` — `AgentsMdRoleSchema`, `roles` on `AgentsMdSchema`, `roles` fields on `HireSummary`.
- `apps/main/src/agents-md/serialize.ts` — emit `roles`.
- `apps/main/src/agents-md/build-export.ts` — collect roles + charters (now takes `userDataDir`).
- `apps/main/src/agents-md/hire.ts` — a roles pass that creates missing roles + writes charters (now takes `userDataDir`).
- `apps/main/src/ipc/agents-md-handlers.ts` — thread `userDataDir` into hire + export.
- `apps/main/src/agents-md/schema.test.ts` *(create if absent — see Task 1)*, `serialize.test.ts`, `build-export.test.ts`, `hire.test.ts` — extend.
- `apps/renderer/src/env.d.ts` + `apps/main/src/ipc/preload.ts` — `agentsMd` parse/hire types gain `roles`.
- `apps/renderer/src/components/settings/AgentsMdImportSection.tsx` + `AgentsMdImportPreview.tsx` — surface the roles count.
- `apps/renderer/src/i18n/en-US.json` + `pt-BR.json` — `previewSubtitle` / `summarySuccess` strings gain a roles count.

---

## Task 1: Schema — `roles` in `AGENTS.md`

**Files:**
- Modify: `apps/main/src/agents-md/schema.ts`
- Create: `apps/main/src/agents-md/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/agents-md/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AgentsMdSchema } from "./schema.js";

const baseAgent = { name: "Ann", role: "Engineer" };

describe("AgentsMdSchema with roles", () => {
  it("accepts a payload with a roles array", () => {
    const result = AgentsMdSchema.safeParse({
      company: "Acme",
      roles: [
        {
          name: "Engineer",
          description: "writes code",
          model: "claude-sonnet-4-6",
          capabilities: ["shell"],
          icon: "👩‍💻",
          charter: "# Engineer\n\n## Identity\n\nbody",
        },
      ],
      agents: [baseAgent],
    });
    expect(result.success).toBe(true);
  });

  it("still accepts a payload with no roles array (back-compat)", () => {
    const result = AgentsMdSchema.safeParse({ company: "Acme", agents: [baseAgent] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.roles).toEqual([]);
  });

  it("rejects a role with no name", () => {
    const result = AgentsMdSchema.safeParse({
      company: "Acme",
      roles: [{ description: "x" }],
      agents: [baseAgent],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/agents-md/schema.test.ts`
Expected: FAIL — the "accepts a roles array" test fails (zod strips/rejects the unknown `roles` key depending on config; the back-compat test's `.roles` is `undefined`, not `[]`).

- [ ] **Step 3: Update `apps/main/src/agents-md/schema.ts`**

Replace the file's contents with:

```ts
import { z } from "zod";

// PR-F.2.2 / M12 PR-D4: zod schema for AGENTS.md YAML front-matter. Lives in
// apps/main (NOT in packages/shared) because zod cannot cross the preload
// sandbox.

export const AgentsMdProjectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

// M12 PR-D4: a role definition carried inside AGENTS.md so the file is
// self-contained — importing it can recreate the role, charter and all.
export const AgentsMdRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  icon: z.string().optional(),
  charter: z.string().optional(),
});

export const AgentsMdAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  reports_to: z.string().optional(),
  projects: z.array(z.string()).optional(),
});

export const AgentsMdSchema = z.object({
  company: z.string().min(1),
  projects: z.array(AgentsMdProjectSchema).default([]),
  roles: z.array(AgentsMdRoleSchema).default([]),
  agents: z.array(AgentsMdAgentSchema).min(1),
});

export type AgentsMdPayload = z.infer<typeof AgentsMdSchema>;
export type AgentsMdProject = z.infer<typeof AgentsMdProjectSchema>;
export type AgentsMdRole = z.infer<typeof AgentsMdRoleSchema>;
export type AgentsMdAgent = z.infer<typeof AgentsMdAgentSchema>;

export type ConflictMode = "skip" | "replace";

export type HireSummary = {
  companyId: string;
  created: {
    projects: number;
    roles: number;
    agents: number;
  };
  skipped: {
    projects: string[];
    roles: string[];
    agents: string[];
  };
  replaced: {
    agents: string[];
  };
  warnings: string[];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/agents-md/schema.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents-md/schema.ts apps/main/src/agents-md/schema.test.ts
git commit -m "feat(agents-md): add roles to the agents.md schema"
```

---

## Task 2: Serialize — emit `roles`

**Files:**
- Modify: `apps/main/src/agents-md/serialize.ts`
- Modify: `apps/main/src/agents-md/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `apps/main/src/agents-md/serialize.test.ts` (inside the existing top-level `describe`, or append a new `describe` block — match the file's existing structure):

```ts
import { parseAgentsMd } from "./parser.js";

describe("serializeAgentsMd with roles", () => {
  it("round-trips a role with a multi-line charter", () => {
    const payload = {
      company: "Acme",
      projects: [],
      roles: [
        {
          name: "Engineer",
          description: "writes code",
          model: "claude-sonnet-4-6",
          capabilities: ["shell"],
          icon: "👩‍💻",
          charter: "# Engineer — Role Charter\n\n## Identity\n\nWrites clean code.\n",
        },
      ],
      agents: [{ name: "Ann", role: "Engineer" }],
    };
    const text = serializeAgentsMd(payload);
    const reparsed = parseAgentsMd(text);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.data.roles[0]?.name).toBe("Engineer");
    expect(reparsed.data.roles[0]?.charter).toContain("## Identity");
  });
});
```

(The `serializeAgentsMd` import already exists at the top of `serialize.test.ts`; add the `parseAgentsMd` import line shown above if it is not already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/agents-md/serialize.test.ts`
Expected: FAIL — `reparsed.data.roles` is empty (serialize does not yet emit `roles`).

- [ ] **Step 3: Update `apps/main/src/agents-md/serialize.ts`**

Replace the file's contents with:

```ts
import matter from "gray-matter";
import type { AgentsMdPayload } from "./schema.js";

// PR-F.2.2 / M12 PR-D4: serialize an AGENTS.md payload back to YAML-front-matter
// markdown. gray-matter.stringify (js-yaml) emits multi-line strings — like a
// role's charter — as readable block scalars, so the whole company stays in
// the structured, zod-validated front-matter.

const BODY = `# Prospero — Team manifest

This file was generated by Prospero. Edit the front-matter above to add roles,
agents, change charters, or rewire reporting. Re-import via
Settings → "Import from AGENTS.md".
`;

export const serializeAgentsMd = (payload: AgentsMdPayload): string => {
  const data: Record<string, unknown> = { company: payload.company };
  if (payload.projects.length > 0) {
    data.projects = payload.projects;
  }
  if (payload.roles.length > 0) {
    data.roles = payload.roles.map((r) => {
      const out: Record<string, unknown> = { name: r.name };
      if (r.description !== undefined) out.description = r.description;
      if (r.model !== undefined) out.model = r.model;
      if (r.capabilities !== undefined && r.capabilities.length > 0)
        out.capabilities = r.capabilities;
      if (r.icon !== undefined) out.icon = r.icon;
      if (r.charter !== undefined) out.charter = r.charter;
      return out;
    });
  }
  data.agents = payload.agents.map((a) => {
    const out: Record<string, unknown> = { name: a.name, role: a.role };
    if (a.model !== undefined) out.model = a.model;
    if (a.capabilities !== undefined && a.capabilities.length > 0)
      out.capabilities = a.capabilities;
    if (a.reports_to !== undefined) out.reports_to = a.reports_to;
    if (a.projects !== undefined && a.projects.length > 0) out.projects = a.projects;
    return out;
  });
  return matter.stringify(BODY, data);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/agents-md/serialize.test.ts`
Expected: PASS — all serialize tests, including the new round-trip.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents-md/serialize.ts apps/main/src/agents-md/serialize.test.ts
git commit -m "feat(agents-md): serialize roles and charters"
```

---

## Task 3: Export — collect roles + charters

**Files:**
- Modify: `apps/main/src/agents-md/build-export.ts`
- Modify: `apps/main/src/agents-md/build-export.test.ts`
- Modify: `apps/main/src/ipc/agents-md-handlers.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `apps/main/src/agents-md/build-export.test.ts` (append a new `it` inside the existing `describe("buildExportPayload", ...)`; the `import { mkdtempSync } from "node:fs"` + `import { tmpdir } from "node:os"` lines may need adding at the top):

```ts
  it("includes the roles used by live agents, with their charters", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const userData = mkdtempSync(join(tmpdir(), "prospero-amd-"));
    createAgentsRepository(db).create({
      companyId: co.id,
      name: "Ann",
      role: "role-engineer",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: "role-engineer",
      model: "claude-sonnet-4-6",
      capabilities: ["shell"],
    });
    const payload = buildExportPayload(db, co.id, userData);
    const engineer = payload.roles.find((r) => r.name === "Engineer");
    expect(engineer).toBeDefined();
    expect(engineer?.charter ?? "").toContain("Identity");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/agents-md/build-export.test.ts`
Expected: FAIL — `buildExportPayload` takes 2 args / `payload.roles` is empty.

- [ ] **Step 3: Update `apps/main/src/agents-md/build-export.ts`**

Replace the file's contents with:

```ts
import type Database from "better-sqlite3";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import { readCharter } from "../agents/role-charter-store.js";
import type { AgentsMdAgent, AgentsMdPayload, AgentsMdRole } from "./schema.js";

// PR-F.2.2 / M12 PR-D4: collect a company's projects, the roles its live agents
// use (charter included), and the agents themselves into AGENTS.md shape.
// reports_to is emitted as the parent agent's NAME so the file is human-readable
// and re-importable. Archived projects and terminated agents are filtered out.

export const buildExportPayload = (
  db: Database.Database,
  companyId: string,
  userDataDir: string,
): AgentsMdPayload => {
  const company = createCompaniesRepository(db)
    .list()
    .find((c) => c.id === companyId);
  if (company === undefined) {
    throw new Error(`Company ${companyId} not found`);
  }

  const projects = createProjectsRepository(db)
    .listByCompany(companyId)
    .filter((p) => p.archivedAt === null)
    .map((p) => ({ name: p.name, path: p.path }));

  const allAgents = createAgentsRepository(db).listByCompany(companyId);
  const liveAgents = allAgents.filter((a) => a.terminatedAt === null);
  const idToName = new Map(liveAgents.map((a) => [a.id, a.name]));

  const roleRepo = createRoleTemplatesRepository(db);
  const roleIdToName = new Map(roleRepo.listAll().map((r) => [r.id, r.name.toLowerCase()]));

  // The distinct roles the live agents actually fill — keyed by templateId, the
  // reliable role-id field. A null templateId (legacy agent) is skipped.
  const usedRoleIds = [
    ...new Set(
      liveAgents
        .map((a) => a.templateId)
        .filter((id): id is string => id !== null && id !== ""),
    ),
  ];
  const roles: AgentsMdRole[] = [];
  for (const roleId of usedRoleIds) {
    const role = roleRepo.getById(roleId);
    if (role === null) continue;
    const out: AgentsMdRole = { name: role.name };
    if (role.description !== "") out.description = role.description;
    if (role.defaultModel !== "") out.model = role.defaultModel;
    if (role.defaultCapabilities.length > 0) out.capabilities = role.defaultCapabilities;
    if (role.icon !== null) out.icon = role.icon;
    out.charter = readCharter(userDataDir, role.id);
    roles.push(out);
  }

  const agents: AgentsMdAgent[] = liveAgents.map((a) => {
    const out: AgentsMdAgent = {
      name: a.name,
      role: roleIdToName.get(a.role) ?? a.role,
    };
    if (a.model !== "") out.model = a.model;
    if (a.capabilities.length > 0) out.capabilities = a.capabilities;
    const parentName = a.reportsTo !== null ? idToName.get(a.reportsTo) : undefined;
    if (parentName !== undefined) out.reports_to = parentName;
    return out;
  });

  return { company: company.name, projects, roles, agents };
};
```

- [ ] **Step 4: Thread `userDataDir` into the export handler**

In `apps/main/src/ipc/agents-md-handlers.ts`, add `app` to the electron import:

```ts
import { app, ipcMain } from "electron";
```

and change the export handler's `buildExportPayload` call:

```ts
    const data = buildExportPayload(db, payload.companyId);
```

to:

```ts
    const data = buildExportPayload(db, payload.companyId, app.getPath("userData"));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/agents-md/build-export.test.ts`
Expected: PASS — all build-export tests, including the new one. (`readCharter` for the seed role `role-engineer` materializes the engineer charter from `SEED_CHARTERS`, so it contains "Identity".)

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/agents-md/build-export.ts apps/main/src/agents-md/build-export.test.ts apps/main/src/ipc/agents-md-handlers.ts
git commit -m "feat(agents-md): export roles with their charters"
```

---

## Task 4: Import — create missing roles, write charters

**Files:**
- Modify: `apps/main/src/agents-md/hire.ts`
- Modify: `apps/main/src/agents-md/hire.test.ts`
- Modify: `apps/main/src/ipc/agents-md-handlers.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `apps/main/src/agents-md/hire.test.ts` (append inside the existing `describe`; add `import { mkdtempSync, existsSync } from "node:fs"`, `import { tmpdir } from "node:os"`, `import { join } from "node:path"`, and `import { roleCharterPath } from "../agents/role-library-dir.js"` at the top if absent — match the file's existing imports/setup helper):

```ts
  it("creates a role from the payload and writes its charter", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const userData = mkdtempSync(join(tmpdir(), "prospero-amd-hire-"));
    const summary = hireFromAgentsMd(
      db,
      {
        company: "Acme",
        projects: [],
        roles: [
          {
            name: "Traffic Manager",
            description: "runs ads",
            model: "claude-sonnet-4-6",
            capabilities: ["web"],
            icon: "📈",
            charter: "# Traffic Manager\n\n## Identity\n\nLeads media buying.\n",
          },
        ],
        agents: [{ name: "Mara", role: "Traffic Manager" }],
      },
      { companyId: co.id, conflictModes: {}, userDataDir: userData },
    );
    expect(summary.created.roles).toBe(1);
    expect(summary.created.agents).toBe(1);
    const role = createRoleTemplatesRepository(db)
      .listAll()
      .find((r) => r.name === "Traffic Manager");
    expect(role).toBeDefined();
    expect(existsSync(roleCharterPath(userData, role!.id))).toBe(true);
  });

  it("skips a role whose name already exists", () => {
    const db = setupDb();
    const co = createCompaniesRepository(db).create({ name: "Acme" });
    const userData = mkdtempSync(join(tmpdir(), "prospero-amd-hire2-"));
    const summary = hireFromAgentsMd(
      db,
      {
        company: "Acme",
        projects: [],
        roles: [{ name: "Engineer", charter: "# x" }],
        agents: [{ name: "Ann", role: "Engineer" }],
      },
      { companyId: co.id, conflictModes: {}, userDataDir: userData },
    );
    expect(summary.created.roles).toBe(0);
    expect(summary.skipped.roles).toEqual(["Engineer"]);
    expect(summary.created.agents).toBe(1);
  });
```

(`setupDb` here must seed the canonical roles — if the existing `hire.test.ts` `setupDb` does not already call `runPostMigration0004`, the "skips an existing role" test relies on the seeded `Engineer` role; add `runPostMigration0004(db)` to the helper, mirroring `build-export.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/agents-md/hire.test.ts`
Expected: FAIL — `hireFromAgentsMd` options have no `userDataDir`; `summary.created.roles` is undefined.

- [ ] **Step 3: Update `apps/main/src/agents-md/hire.ts`**

Replace the file's contents with:

```ts
import type Database from "better-sqlite3";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import { writeCharter } from "../agents/role-charter-store.js";
import type { AgentsMdPayload, ConflictMode, HireSummary } from "./schema.js";

// PR-F.2.2 / M12 PR-D4: import an AGENTS.md payload into an existing company.
//   * Roles keyed by name: a role whose name already exists is reused (skipped);
//     otherwise it is created and its charter (if any) written to disk.
//   * Projects keyed by path: a row with the same (company_id, path) is skipped.
//   * Agents keyed by name within the company: existing name → consult
//     conflictModes[name]. 'skip' leaves it; 'replace' terminates the old one
//     (we never DELETE — preserves history) and creates a fresh row.
//   * reports_to wired in a second pass by looking up the freshly-created name.

const DEFAULT_MODEL = "claude-sonnet-4-6";

export type HireOptions = {
  companyId: string;
  conflictModes: Record<string, ConflictMode>;
  userDataDir: string;
};

const findRoleId = (
  db: Database.Database,
  roleHint: string,
): { id: string; defaultModel: string; defaultCapabilities: string[] } | null => {
  const roles = createRoleTemplatesRepository(db).listAll();
  const lower = roleHint.toLowerCase();
  const match =
    roles.find((r) => r.id.toLowerCase() === lower) ??
    roles.find((r) => r.name.toLowerCase() === lower) ??
    roles.find((r) => r.id.toLowerCase() === `role-${lower}`);
  if (match === undefined) return null;
  return {
    id: match.id,
    defaultModel: match.defaultModel,
    defaultCapabilities: match.defaultCapabilities,
  };
};

export const hireFromAgentsMd = (
  db: Database.Database,
  payload: AgentsMdPayload,
  opts: HireOptions,
): HireSummary => {
  const summary: HireSummary = {
    companyId: opts.companyId,
    created: { projects: 0, roles: 0, agents: 0 },
    skipped: { projects: [], roles: [], agents: [] },
    replaced: { agents: [] },
    warnings: [],
  };

  const projectsRepo = createProjectsRepository(db);
  const agentsRepo = createAgentsRepository(db);
  const roleRepo = createRoleTemplatesRepository(db);

  // Roles pass — create any role whose name is not already taken.
  const existingRoleNames = new Set(roleRepo.listAll().map((r) => r.name.toLowerCase()));
  for (const r of payload.roles) {
    if (existingRoleNames.has(r.name.toLowerCase())) {
      summary.skipped.roles.push(r.name);
      continue;
    }
    const created = roleRepo.create({
      name: r.name,
      description: r.description ?? "",
      icon: r.icon ?? null,
      defaultModel: r.model ?? DEFAULT_MODEL,
      defaultCapabilities: r.capabilities ?? [],
    });
    if (r.charter !== undefined && r.charter.trim() !== "") {
      writeCharter(opts.userDataDir, created.id, r.charter);
    }
    existingRoleNames.add(r.name.toLowerCase());
    summary.created.roles += 1;
  }

  const existingProjects = projectsRepo.listByCompany(opts.companyId);
  const existingPaths = new Set(existingProjects.map((p) => p.path));
  for (const p of payload.projects) {
    if (existingPaths.has(p.path)) {
      summary.skipped.projects.push(p.name);
      continue;
    }
    projectsRepo.create({
      companyId: opts.companyId,
      name: p.name,
      path: p.path,
      color: "#6366f1",
    });
    summary.created.projects += 1;
  }

  const existingAgents = agentsRepo.listByCompany(opts.companyId);
  const existingByName = new Map(existingAgents.map((a) => [a.name, a]));
  const createdByName = new Map<string, string>();

  for (const a of payload.agents) {
    const role = findRoleId(db, a.role);
    if (role === null) {
      summary.warnings.push(`agent "${a.name}": unknown role "${a.role}" — skipped`);
      summary.skipped.agents.push(a.name);
      continue;
    }

    const conflict = existingByName.get(a.name);
    if (conflict !== undefined && conflict.terminatedAt === null) {
      const mode = opts.conflictModes[a.name] ?? "skip";
      if (mode === "skip") {
        summary.skipped.agents.push(a.name);
        createdByName.set(a.name, conflict.id);
        continue;
      }
      agentsRepo.terminate(conflict.id, "replaced by agents.md import");
      summary.replaced.agents.push(a.name);
    }

    const created = agentsRepo.create({
      companyId: opts.companyId,
      name: a.name,
      role: role.id,
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: role.id,
      model: a.model ?? role.defaultModel,
      capabilities: a.capabilities ?? role.defaultCapabilities,
      actor: { kind: "user" },
    });
    summary.created.agents += 1;
    createdByName.set(a.name, created.id);
  }

  for (const a of payload.agents) {
    if (a.reports_to === undefined || a.reports_to === "") continue;
    const childId = createdByName.get(a.name);
    if (childId === undefined) continue;
    const parentId = createdByName.get(a.reports_to);
    if (parentId === undefined) {
      summary.warnings.push(
        `agent "${a.name}": reports_to "${a.reports_to}" not found in payload — left unset`,
      );
      continue;
    }
    agentsRepo.setReportsTo(childId, parentId);
  }

  return summary;
};
```

- [ ] **Step 4: Thread `userDataDir` into the hire handler**

In `apps/main/src/ipc/agents-md-handlers.ts`, change the `hireFromAgentsMd` call:

```ts
      return hireFromAgentsMd(db, reparsed.data, {
        companyId: payload.companyId,
        conflictModes: payload.conflictModes ?? {},
      });
```

to:

```ts
      return hireFromAgentsMd(db, reparsed.data, {
        companyId: payload.companyId,
        conflictModes: payload.conflictModes ?? {},
        userDataDir: app.getPath("userData"),
      });
```

(`app` was already imported in Task 3 Step 4.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/agents-md/hire.test.ts`
Expected: PASS — all hire tests, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/agents-md/hire.ts apps/main/src/agents-md/hire.test.ts apps/main/src/ipc/agents-md-handlers.ts
git commit -m "feat(agents-md): import roles and their charters"
```

---

## Task 5: Renderer — surface the roles count

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`
- Modify: `apps/renderer/src/components/settings/AgentsMdImportSection.tsx`
- Modify: `apps/renderer/src/components/settings/AgentsMdImportPreview.tsx`
- Modify: `apps/renderer/src/i18n/en-US.json` + `pt-BR.json`

Wiring + display — verified by typecheck/lint (Step 6) and the i18n parity test.

- [ ] **Step 1: Add `roles` to the `agentsMd` types in `preload.ts`**

In `apps/main/src/ipc/preload.ts`, the `agentsMd.parse` return type's `data` object and the `agentsMd.hire` return type need a `roles` field. In the `parse` method's `data` type, add after `projects: { name: string; path: string }[];`:

```ts
              roles: {
                name: string;
                description?: string;
                model?: string;
                capabilities?: string[];
                icon?: string;
                charter?: string;
              }[];
```

In the `hire` method's return type, change `created: { projects: number; agents: number };` to:

```ts
        created: { projects: number; roles: number; agents: number };
```

and `skipped: { projects: string[]; agents: string[] };` to:

```ts
        skipped: { projects: string[]; roles: string[]; agents: string[] };
```

- [ ] **Step 2: Mirror the type changes in `env.d.ts`**

In `apps/renderer/src/env.d.ts`, apply the identical three edits to the `agentsMd` block (the `parse` data object gains `roles`, the `hire` return `created` gains `roles: number`, `skipped` gains `roles: string[]`).

- [ ] **Step 3: Update `AgentsMdImportSection.tsx`**

In `apps/renderer/src/components/settings/AgentsMdImportSection.tsx`:

Add `roles` to the local `Parsed` type — after the `projects` line:

```ts
  roles: {
    name: string;
    description?: string;
    model?: string;
    capabilities?: string[];
    icon?: string;
    charter?: string;
  }[];
```

Change the `summary` state type from `{ projects: number; agents: number; warnings: string[] } | null` to:

```ts
  const [summary, setSummary] = useState<{
    projects: number;
    roles: number;
    agents: number;
    warnings: string[];
  } | null>(null);
```

In `onHire`, change the `setSummary` call to include roles:

```ts
      setSummary({
        projects: result.created.projects,
        roles: result.created.roles,
        agents: result.created.agents,
        warnings: result.warnings,
      });
```

In the summary render, change the `summarySuccess` interpolation to pass roles:

```ts
            {t("settings.agentsMd.summarySuccess", {
              projects: summary.projects,
              roles: summary.roles,
              agents: summary.agents,
            })}
```

- [ ] **Step 4: Update `AgentsMdImportPreview.tsx`**

In `apps/renderer/src/components/settings/AgentsMdImportPreview.tsx`, add `roles` to the local `ParsedData` type (after the `projects` line):

```ts
  roles: {
    name: string;
    description?: string;
    model?: string;
    capabilities?: string[];
    icon?: string;
    charter?: string;
  }[];
```

and change the `previewSubtitle` interpolation to pass roles:

```ts
          {t("settings.agentsMd.previewSubtitle", {
            projects: data.projects.length,
            roles: data.roles.length,
            agents: data.agents.length,
          })}
```

- [ ] **Step 5: Update the two i18n strings**

In `apps/renderer/src/i18n/en-US.json`, find `settings.agentsMd.previewSubtitle` and `settings.agentsMd.summarySuccess` and update them to mention roles:

```json
    "previewSubtitle": "{{projects}} project(s), {{roles}} role(s), {{agents}} agent(s)",
    "summarySuccess": "Imported {{projects}} project(s), {{roles}} role(s), {{agents}} agent(s)."
```

In `apps/renderer/src/i18n/pt-BR.json`, the matching keys:

```json
    "previewSubtitle": "{{projects}} projeto(s), {{roles}} papel(éis), {{agents}} agente(s)",
    "summarySuccess": "Importado(s) {{projects}} projeto(s), {{roles}} papel(éis), {{agents}} agente(s)."
```

(Only the string values change — the keys are unchanged, so the i18n parity test stays green. If the existing strings phrase things differently, keep their style and just add the `{{roles}}` count.)

- [ ] **Step 6: Typecheck + lint + parity test**

Run: `pnpm --filter @prospero/main run typecheck && pnpm --filter @prospero/renderer run typecheck && pnpm --filter @prospero/renderer run lint && pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: all exit 0 / PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts apps/renderer/src/components/settings/AgentsMdImportSection.tsx apps/renderer/src/components/settings/AgentsMdImportPreview.tsx apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(agents-md): surface the roles count in the import ui"
```

---

## Task 6: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: every package exits 0.

- [ ] **Step 2: Lint the whole workspace**

Run: `pnpm lint`
Expected: every package exits 0.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all packages green. New tests: `schema.test.ts` (3) + the new cases in `serialize.test.ts` (1), `build-export.test.ts` (1), `hire.test.ts` (2) — 7 new. Expect roughly **1296 passing + 2 todo** (baseline 1289 + 7), no regressions.

- [ ] **Step 4: Manual smoke (record the result, do not skip)**

Run `pnpm dev`:
1. In a company with at least one agent, Settings → "Export AGENTS.md". Open the
   downloaded file — the YAML front-matter has a `roles:` array, each role with
   a `charter: |` block scalar.
2. Settings → "Import from AGENTS.md", pick that file. The preview subtitle
   shows the roles count.
3. Import into a *different* company → the summary reports the imported role
   count; the roles appear in `/roles` with their charters intact.
4. Import the same file again → roles are skipped (names already exist), no
   duplicates.

Record the smoke result in the commit/PR notes.

- [ ] **Step 5: Final commit (only if smoke surfaced fixes)**

```bash
git add -A
git commit -m "fix(agents-md): address charter import/export smoke findings"
```

---

## Self-Review Notes

- **Spec coverage (design doc §4.4(b)):** "o import/export de `AGENTS.md` é estendido para carregar os charters dentro" → Tasks 1-4 (schema `roles` with `charter`, serialize, export collects + reads charters, import creates roles + writes charters). "Uma empresa inteira vira um arquivo único — versionável" → the whole company (projects + roles + charters + agents) now serializes to one file. "Importar recria a organização com os charters" → Task 4 roles pass.
- **Back-compat:** `roles` is `.default([])` on the schema, so an old `AGENTS.md` with no `roles` key still parses (Task 1 test covers it); export of a company whose agents have a null `templateId` simply omits those roles.
- **Type consistency:** `AgentsMdRole` (Task 1) is the shape produced by `build-export` (Task 3), emitted by `serialize` (Task 2), and consumed by `hire` (Task 4). `HireSummary.created.roles` / `skipped.roles` (Task 1) are written in Task 4 and read in Task 5. `HireOptions` gains `userDataDir` (Task 4), supplied by the handler (Task 4 Step 4). `buildExportPayload`'s new 3-arg signature (Task 3) matches its handler call.
- **No placeholder scan hits.** Every code step shows complete code; the few "match the existing file" notes (test imports/`setupDb`) are about aligning with already-present helpers, not deferred work.
