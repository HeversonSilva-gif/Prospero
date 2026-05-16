# M11 PR-E1 — Role inheritance + skill promotion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skills flow between agents — an agent inherits the company-global and its-role skills/memories into its system prompt (descending flow), and can request that one of its private skills be promoted to company-shared, which the user reviews and approves (ascending flow).

**Architecture:** `buildMemoryBlock` (the spawn-time system-prompt assembler) stops loading *all* company-shared skills and instead loads company-global (role-unscoped) + the agent's-role skills/memories — making inheritance role-correct. `skill_promote` is a new MCP tool: the agent calls it, it files a `skill_promotion_requested` inbox item — it does **not** mutate the skill. The user reviews via an inbox modal (skill body preview + role picker) and approves; an IPC handler then promotes the skill row (`agent_id`→NULL, `promoted`=1, `applies_to_role`=picked).

**Tech Stack:** TypeScript, better-sqlite3, `@modelcontextprotocol/sdk`, zod, Electron IPC, React, react-i18next, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md` §1.2 (descending/ascending flow), §5 (`skill_promote`), §6 (system-prompt injection), §11 PR-E.

## Decisions locked for this plan

- **PR-E is split.** PR-E1 (this plan) ships the bidirectional **skill flow**: role-based inheritance (down) + `skill_promote` (up). **PR-E2** (a later plan) ships the **memory-derivation triggers** (`goal.achieved`→retrospective, `approval.rejected`→preference — they extend the PR-D derivation engine), the `goal_retrospective_ready` inbox, the `/dashboard` "Org Learnings" card, and the terminate-modal "promote private skills?" flow. PR-E1 is coherent and shippable on its own.
- **Role inheritance is a correctness fix, not just an addition.** PR-C's `buildMemoryBlock` loads `listCompanyShared` — *every* company-shared skill regardless of role — so a designer-scoped skill currently leaks into an engineer's prompt. PR-E1 splits "company-shared" into **company-global** (`applies_to_role IS NULL` → all agents) and **role-scoped** (`applies_to_role = X` → only role-X agents), and `buildMemoryBlock` loads global + the agent's role only. New repo methods `listCompanyGlobal*` are added; the existing `listCompanyShared`/`listCompanyWide` keep their current "all `agent_id IS NULL`" semantics (the MCP `skill_search`/`memory_read` tools still use them — on-demand search showing everything is acceptable).
- **`skill_promote` does not mutate the skill.** Per spec §5 "não aplica direto" — it only files an inbox request. The user's approval (an IPC handler) performs the actual `skills.promote`. Defence: a skill becoming company-wide is an org-level change that needs human sign-off.
- **Promotion sets `applies_to_role` from a picker.** The approval modal lets the user scope the promoted skill to a role (matches the inheritance half) or make it company-global (role = null). Approve = `agent_id`→NULL, `promoted`→1, `applies_to_role`→picked.
- **`promoted` skills are already read-only to the agent** — PR-C's `skill_update` rejects `skill.promoted`. PR-E1 adds nothing there; it just makes sure `promote` sets `promoted=1`.
- **The approval IPC lives in `learning-handlers.ts`** — consistent with where PR-D2 put the candidate accept/reject handlers. Exposed as `window.prospero.learning.approveSkillPromotion`.

## File structure

| File | Responsibility |
|---|---|
| `apps/main/src/memory/skills-repository.ts` (modify) | `listCompanyGlobal` + `promote` |
| `apps/main/src/memory/memories-repository.ts` (modify) | `listCompanyGlobal` |
| `apps/main/src/orchestrator/system-prompt-memory.ts` (modify) | role-scoped inheritance in `buildMemoryBlock` |
| `apps/main/src/ipc/orchestrator-handlers.ts` (modify) | pass `agent.role` to `buildMemoryBlock` |
| `apps/main/src/db/migrations/0020_inbox_skill_promotion_kind.sql` | inbox `kind` += `skill_promotion_requested` |
| `packages/shared/src/types/inbox.ts` (modify) | add `skill_promotion_requested` |
| `packages/shared/src/ipc-channels.ts` (modify) | `SKILL_PROMOTE_APPROVE` channel |
| `packages/shared/src/capabilities.ts` (modify) | add `skill_promote` to the `memory` capability |
| `apps/main/src/mcp/tools-memory.ts` (modify) | the `skill_promote` MCP tool |
| `apps/main/src/ipc/learning-handlers.ts` (modify) | `approveSkillPromotion` handler |
| `apps/main/src/ipc/preload.ts` (modify) | `learning.approveSkillPromotion` bridge |
| `apps/renderer/src/env.d.ts` (modify) | typed surface |
| `apps/renderer/src/components/inbox/SkillPromotionModal.tsx` | the review modal |
| `apps/renderer/src/routes/Inbox.tsx` (modify) | wire the modal to the inbox item |
| `apps/renderer/src/i18n/{pt-BR,en-US}.json` (modify) | promotion modal i18n |
| `apps/renderer/src/i18n/parity.test.ts` (modify) | parity check |

Dependencies: Task 1 independent. Task 2 depends on Task 1. Task 3 independent. Task 4 depends on Task 3. Task 5 depends on Tasks 1 + 3. Task 6 depends on Tasks 3 + 5.

---

## Task 1: Repository data layer — `listCompanyGlobal` + `promote`

`buildMemoryBlock` needs to load *company-global* (role-unscoped) skills/memories separately from role-scoped ones; the promotion approval needs to flip a skill to company-shared.

**Files:**
- Modify: `apps/main/src/memory/skills-repository.ts`
- Modify: `apps/main/src/memory/memories-repository.ts`
- Modify: `apps/main/src/memory/skills-repository.test.ts`
- Modify: `apps/main/tests/memories.repository.test.ts` (or create a co-located test — see Step 4)

- [ ] **Step 1: Write the failing skills test**

In `apps/main/src/memory/skills-repository.test.ts`, add inside the existing top-level `describe`:

```typescript
describe("skills-repository listCompanyGlobal + promote", () => {
  it("listCompanyGlobal returns only role-unscoped company-shared skills", () => {
    const db = seed();
    const repo = createSkillCandidatesUnusedHelper(db);
    void repo;
    const skills = createSkillsRepository(db);
    skills.create({
      companyId: "c1",
      agentId: null,
      name: "global-skill",
      bodyPath: "p1",
      description: "everyone",
      source: "user_authored",
    });
    skills.create({
      companyId: "c1",
      agentId: null,
      name: "eng-skill",
      bodyPath: "p2",
      description: "engineers",
      source: "user_authored",
      appliesToRole: "engineer",
    });
    expect(skills.listCompanyGlobal("c1").map((s) => s.name)).toEqual(["global-skill"]);
  });

  it("promote flips a private skill to company-shared with a role", () => {
    const db = seed();
    const skills = createSkillsRepository(db);
    const created = skills.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const promoted = skills.promote(created.id, "engineer");
    expect(promoted.agentId).toBeNull();
    expect(promoted.promoted).toBe(true);
    expect(promoted.appliesToRole).toBe("engineer");
    // it now appears in listForRole, not listByAgent
    expect(skills.listByAgent("a1")).toHaveLength(0);
    expect(skills.listForRole("c1", "engineer").map((s) => s.name)).toEqual(["deploy"]);
  });

  it("promote with a null role makes the skill company-global", () => {
    const db = seed();
    const skills = createSkillsRepository(db);
    const created = skills.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const promoted = skills.promote(created.id, null);
    expect(promoted.appliesToRole).toBeNull();
    expect(skills.listCompanyGlobal("c1").map((s) => s.name)).toEqual(["x"]);
  });
});
```

> The `createSkillCandidatesUnusedHelper` line above is a mistake — **delete those two lines** (`const repo = ...` and `void repo;`). The test only needs `createSkillsRepository`. (Kept here as a deliberate no-op to remove; if the test file's `seed()` helper does not exist, copy the `seed` from the existing `skill-candidates-repository.test.ts` in the same folder — an in-memory DB with `applyMigrations`, a company `c1`, and an agent `a1`.)

Use this clean version of the test block instead (replace the buggy lines):

```typescript
describe("skills-repository listCompanyGlobal + promote", () => {
  it("listCompanyGlobal returns only role-unscoped company-shared skills", () => {
    const db = seed();
    const skills = createSkillsRepository(db);
    skills.create({
      companyId: "c1",
      agentId: null,
      name: "global-skill",
      bodyPath: "p1",
      description: "everyone",
      source: "user_authored",
    });
    skills.create({
      companyId: "c1",
      agentId: null,
      name: "eng-skill",
      bodyPath: "p2",
      description: "engineers",
      source: "user_authored",
      appliesToRole: "engineer",
    });
    expect(skills.listCompanyGlobal("c1").map((s) => s.name)).toEqual(["global-skill"]);
  });

  it("promote flips a private skill to company-shared with a role", () => {
    const db = seed();
    const skills = createSkillsRepository(db);
    const created = skills.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const promoted = skills.promote(created.id, "engineer");
    expect(promoted.agentId).toBeNull();
    expect(promoted.promoted).toBe(true);
    expect(promoted.appliesToRole).toBe("engineer");
    expect(skills.listByAgent("a1")).toHaveLength(0);
    expect(skills.listForRole("c1", "engineer").map((s) => s.name)).toEqual(["deploy"]);
  });

  it("promote with a null role makes the skill company-global", () => {
    const db = seed();
    const skills = createSkillsRepository(db);
    const created = skills.create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const promoted = skills.promote(created.id, null);
    expect(promoted.appliesToRole).toBeNull();
    expect(skills.listCompanyGlobal("c1").map((s) => s.name)).toEqual(["x"]);
  });
});
```

Ensure the test file imports `createSkillsRepository` (and has a `seed` helper / `createSkillsRepository` import — the file already exists from PR-D2 Task 1).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/skills-repository.test.ts`
Expected: FAIL — `skills.listCompanyGlobal` / `skills.promote` are not functions.

- [ ] **Step 3: Add `listCompanyGlobal` + `promote` to the skills repository**

In `apps/main/src/memory/skills-repository.ts`:

- Add to the `SkillsRepository` type, after `listForRole`:

```typescript
  listCompanyGlobal(companyId: string): Skill[];
  promote(id: string, appliesToRole: string | null): Skill;
```

- Add these prepared statements next to `forRole`:

```typescript
  const companyGlobal = db.prepare(
    "SELECT * FROM skills WHERE company_id = ? AND agent_id IS NULL AND applies_to_role IS NULL AND soft_deleted = 0 ORDER BY use_count DESC, created_at DESC",
  );
  const promoteStmt = db.prepare(
    "UPDATE skills SET agent_id = NULL, promoted = 1, applies_to_role = ? WHERE id = ?",
  );
```

- Add the two methods to the returned object, after `listForRole`:

```typescript
    listCompanyGlobal(companyId) {
      return (companyGlobal.all(companyId) as SkillRow[]).map(rowToSkill);
    },
    promote(id, appliesToRole) {
      if ((byId.get(id) as SkillRow | undefined) === undefined) {
        throw new Error(`skill not found: ${id}`);
      }
      promoteStmt.run(appliesToRole, id);
      return getById(id)!;
    },
```

- [ ] **Step 4: Write the failing memories test**

The memories repository test file is `apps/main/tests/memories.repository.test.ts` (a `tests/`-folder test). If it does not exist, create it; if it exists, add the `describe`. Full file content if creating it:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createMemoriesRepository } from "../src/memory/memories-repository.js";

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

describe("memories-repository listCompanyGlobal", () => {
  it("returns only role-unscoped company-wide memories", () => {
    const db = seed();
    const repo = createMemoriesRepository(db);
    repo.create({ companyId: "c1", agentId: null, kind: "rule", body: "global rule" });
    repo.create({
      companyId: "c1",
      agentId: null,
      kind: "rule",
      body: "engineer rule",
      appliesToRole: "engineer",
    });
    expect(repo.listCompanyGlobal("c1").map((m) => m.body)).toEqual(["global rule"]);
  });
});
```

- [ ] **Step 5: Run the memories test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/memories.repository.test.ts`
Expected: FAIL — `repo.listCompanyGlobal` is not a function.

- [ ] **Step 6: Add `listCompanyGlobal` to the memories repository**

In `apps/main/src/memory/memories-repository.ts`:

- Add to the `MemoriesRepository` type, after `listForRole`:

```typescript
  listCompanyGlobal(companyId: string): Memory[];
```

- Add the prepared statement next to the existing `forRole` statement:

```typescript
  const companyGlobal = db.prepare(
    "SELECT * FROM memories WHERE company_id = ? AND agent_id IS NULL AND applies_to_role IS NULL AND soft_deleted = 0 ORDER BY importance DESC, created_at DESC",
  );
```

- Add the method to the returned object, after `listForRole`:

```typescript
    listCompanyGlobal(companyId) {
      return (companyGlobal.all(companyId) as MemoryRow[]).map(rowToMemory);
    },
```

> Use the file's existing `MemoryRow` type and `rowToMemory` helper — match the style of `listForRole`.

- [ ] **Step 7: Run the tests + typecheck**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/skills-repository.test.ts tests/memories.repository.test.ts`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/main/src/memory/skills-repository.ts apps/main/src/memory/memories-repository.ts apps/main/src/memory/skills-repository.test.ts apps/main/tests/memories.repository.test.ts
git commit -m "feat(m11): add listCompanyGlobal and skill promote to the memory repos"
```

---

## Task 2: Role-scoped inheritance in `buildMemoryBlock`

`buildMemoryBlock` stops loading every company-shared skill and instead loads company-global + the agent's-role skills/memories. The spawn site passes `agent.role`.

**Files:**
- Modify: `apps/main/src/orchestrator/system-prompt-memory.ts`
- Modify: `apps/main/src/orchestrator/system-prompt-memory.test.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

- [ ] **Step 1: Write the failing test**

In `apps/main/src/orchestrator/system-prompt-memory.test.ts`, add inside the existing top-level `describe`. (The file's existing `setup` helper builds a db + repos; the existing tests call `buildMemoryBlock` with a deps object. Match that shape — add a `role` field.)

```typescript
describe("buildMemoryBlock — role inheritance", () => {
  it("includes a skill scoped to the agent's role", () => {
    const s = setup();
    s.skillsRepo.create({
      companyId: "c1",
      agentId: null,
      name: "eng-runbook",
      bodyPath: "p",
      description: "ENG-ROLE-SKILL",
      source: "user_authored",
      appliesToRole: "engineer",
    });
    const block = buildMemoryBlock(deps(s, "engineer")) ?? "";
    expect(block).toContain("ENG-ROLE-SKILL");
  });

  it("excludes a skill scoped to a different role", () => {
    const s = setup();
    s.skillsRepo.create({
      companyId: "c1",
      agentId: null,
      name: "design-runbook",
      bodyPath: "p",
      description: "DESIGN-ROLE-SKILL",
      source: "user_authored",
      appliesToRole: "designer",
    });
    const block = buildMemoryBlock(deps(s, "engineer")) ?? "";
    expect(block).not.toContain("DESIGN-ROLE-SKILL");
  });

  it("includes a company-global (role-unscoped) skill for any role", () => {
    const s = setup();
    s.skillsRepo.create({
      companyId: "c1",
      agentId: null,
      name: "global-runbook",
      bodyPath: "p",
      description: "GLOBAL-SKILL",
      source: "user_authored",
    });
    expect(buildMemoryBlock(deps(s, "designer")) ?? "").toContain("GLOBAL-SKILL");
  });

  it("includes a memory scoped to the agent's role", () => {
    const s = setup();
    s.memoriesRepo.create({
      companyId: "c1",
      agentId: null,
      kind: "rule",
      body: "ENG-ROLE-MEMORY",
      appliesToRole: "engineer",
    });
    expect(buildMemoryBlock(deps(s, "engineer")) ?? "").toContain("ENG-ROLE-MEMORY");
  });
});
```

> The existing tests use a `deps(s)` helper that returns the `BuildMemoryBlockDeps` object. You will change `deps` to take a `role` argument: `const deps = (s, role = "engineer") => ({ ...existing fields..., role });`. Update the helper and the existing test call sites accordingly (they can all pass the default — only the new tests pass a specific role). If the existing `deps` helper is inlined per-test rather than a shared function, add `role: "engineer"` to each existing call and a specific role to the new tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/system-prompt-memory.test.ts`
Expected: FAIL — `role` is not a property of `BuildMemoryBlockDeps` (typecheck error in the test) / the role-scoped skill is absent.

- [ ] **Step 3: Add `role` to `BuildMemoryBlockDeps` and use role-scoped queries**

In `apps/main/src/orchestrator/system-prompt-memory.ts`:

- Add `role` to `BuildMemoryBlockDeps`:

```typescript
export type BuildMemoryBlockDeps = {
  memoriesRepo: MemoriesRepository;
  skillsRepo: SkillsRepository;
  userDataDir: string;
  companyId: string;
  agentId: string;
  role: string;
};
```

- Replace the company-memory line:

```typescript
  const company = renderMemories(deps.memoriesRepo.listCompanyWide(deps.companyId), COMPANY_CAP);
```

with:

```typescript
  const company = renderMemories(
    [
      ...deps.memoriesRepo.listCompanyGlobal(deps.companyId),
      ...deps.memoriesRepo.listForRole(deps.companyId, deps.role),
    ],
    COMPANY_CAP,
  );
```

- Replace the skills assembly:

```typescript
  const skills = renderSkills(
    [
      ...deps.skillsRepo.listByAgent(deps.agentId),
      ...deps.skillsRepo.listCompanyShared(deps.companyId),
    ],
    SKILLS_CAP,
  );
```

with:

```typescript
  const skills = renderSkills(
    [
      ...deps.skillsRepo.listByAgent(deps.agentId),
      ...deps.skillsRepo.listForRole(deps.companyId, deps.role),
      ...deps.skillsRepo.listCompanyGlobal(deps.companyId),
    ],
    SKILLS_CAP,
  );
```

- [ ] **Step 4: Pass `agent.role` at the spawn site**

In `apps/main/src/ipc/orchestrator-handlers.ts`, the `buildMemoryBlock({ ... })` call (around line 291) currently passes `memoriesRepo`, `skillsRepo`, `userDataDir`, `companyId: agent.companyId`, `agentId: agent.id`. Add one line to that object literal:

```typescript
    role: agent.role,
```

> `agent` is the `Agent` object; `Agent.role` is a `string` (verified in `packages/shared/src/types/agent.ts`).

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator/system-prompt-memory.test.ts`
Expected: PASS — including the existing tests (now passing `role`) and the 4 new role-inheritance tests.

Run: `pnpm typecheck`
Expected: PASS — no other `buildMemoryBlock` call site exists besides the spawn site and the tests.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/orchestrator/system-prompt-memory.ts apps/main/src/orchestrator/system-prompt-memory.test.ts apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(m11): inject role-scoped skills and memories into the system prompt"
```

---

## Task 3: Inbox kind `skill_promotion_requested`

`skill_promote` files an inbox item of a new kind. SQLite cannot alter a CHECK in place — recreate `inbox_items` (the established `0019` pattern).

**Files:**
- Create: `apps/main/src/db/migrations/0020_inbox_skill_promotion_kind.sql`
- Modify: `packages/shared/src/types/inbox.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/tests/migration.0020-inbox-skill-promotion.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

describe("migration 0020 — inbox skill_promotion_requested kind", () => {
  it("accepts an inbox item with kind skill_promotion_requested", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb1','c1','skill_promotion_requested','Promote skill',1,0)`,
    ).run();
    const row = db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb1'").get() as {
      kind: string;
    };
    expect(row.kind).toBe("skill_promotion_requested");
  });

  it("still accepts the prior skill_candidate_pending kind", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO inbox_items (id, company_id, kind, title, requires_action, created_at)
       VALUES ('inb2','c1','skill_candidate_pending','x',1,0)`,
    ).run();
    expect(
      (db.prepare("SELECT kind FROM inbox_items WHERE id = 'inb2'").get() as { kind: string })
        .kind,
    ).toBe("skill_candidate_pending");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/migration.0020-inbox-skill-promotion.test.ts`
Expected: FAIL — the `skill_promotion_requested` insert throws a CHECK-constraint error.

- [ ] **Step 3: Create the migration**

Create `apps/main/src/db/migrations/0020_inbox_skill_promotion_kind.sql`:

```sql
-- M11 PR-E: extend inbox_items.kind CHECK constraint to allow skill_promotion_requested.
--
-- SQLite cannot ALTER a CHECK constraint in place — recreate the table with
-- the expanded set. defer_foreign_keys so the FK on actor_id->agents.id stays
-- valid during the swap.

PRAGMA defer_foreign_keys = 1;

CREATE TABLE inbox_items_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN (
      'approval',
      'completed',
      'suggestion',
      'error',
      'security_alert',
      'goal_proposed',
      'goal_executing',
      'goal_error',
      'agent_unresponsive',
      'skill_candidate_pending',
      'skill_promotion_requested'
    )),
  actor_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,
  requires_action INTEGER NOT NULL DEFAULT 0
    CHECK (requires_action IN (0,1)),
  approval_id TEXT REFERENCES approvals(id) ON DELETE SET NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

INSERT INTO inbox_items_new
  (id, company_id, kind, actor_id, title, preview, payload_json,
   requires_action, approval_id, read_at, created_at)
SELECT
  id, company_id, kind, actor_id, title, preview, payload_json,
  requires_action, approval_id, read_at, created_at
FROM inbox_items;

DROP TABLE inbox_items;
ALTER TABLE inbox_items_new RENAME TO inbox_items;
```

- [ ] **Step 4: Add the kind to the shared type**

In `packages/shared/src/types/inbox.ts`, add `| "skill_promotion_requested"` to the `InboxKind` union, after `"skill_candidate_pending"`.

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @prospero/main exec vitest run tests/migration.0020-inbox-skill-promotion.test.ts`
Expected: PASS (2 tests)

Run: `pnpm typecheck`
Expected: PASS

> Adding to `InboxKind` triggers the `Record<InboxKind, string>` exhaustiveness check in `apps/renderer/src/routes/Inbox.tsx` (the `KIND_BORDER` map). Typecheck WILL fail there until Task 6 adds the entry. **For this task, also add the `KIND_BORDER` entry now** so typecheck stays green: in `apps/renderer/src/routes/Inbox.tsx`, add `skill_promotion_requested: "border-l-4 border-l-brand",` to the `KIND_BORDER` map. (Task 6 builds the rest of the Inbox wiring; this one line keeps the build green between tasks.)

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/db/migrations/0020_inbox_skill_promotion_kind.sql packages/shared/src/types/inbox.ts apps/renderer/src/routes/Inbox.tsx apps/main/tests/migration.0020-inbox-skill-promotion.test.ts
git commit -m "feat(m11): add skill_promotion_requested inbox kind"
```

---

## Task 4: `skill_promote` MCP tool

The agent calls `skill_promote(name)` to request that one of its private skills become company-shared. It files a `skill_promotion_requested` inbox item — it does not mutate the skill.

**Files:**
- Modify: `packages/shared/src/capabilities.ts`
- Modify: `packages/shared/tests/capabilities.test.ts`
- Modify: `apps/main/src/mcp/tools-memory.ts`
- Modify: `apps/main/src/mcp/tools-memory.test.ts`

- [ ] **Step 1: Add `skill_promote` to the `memory` capability**

In `packages/shared/src/capabilities.ts`, the `memory` capability's `tools` array lists 9 `mcp__dashboard__*` tools. Add a 10th, after `mcp__dashboard__skill_update`:

```typescript
      "mcp__dashboard__skill_promote",
```

- [ ] **Step 2: Update the capability test**

In `packages/shared/tests/capabilities.test.ts`, find the test that asserts the `memory` capability tool count (PR-C added `expect(CAPABILITY_CATALOG.memory.tools).toHaveLength(9)`). Change `9` to `10`, and add an assertion:

```typescript
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__skill_promote");
```

- [ ] **Step 3: Write the failing tool test**

In `apps/main/src/mcp/tools-memory.test.ts`, add a new `describe` block (the file's `newCtx` helper builds a `ToolContext` with an in-memory db, company `c1`, agent `a1`; the `tool(name)` helper looks a tool up in `memoryToolDefinitions`):

```typescript
describe("skill_promote tool", () => {
  it("files a skill_promotion_requested inbox item for a private skill", async () => {
    const ctx = newCtx();
    await tool("skill_create").run(
      { name: "deploy-runbook", description: "how to deploy", body: "1. build" },
      ctx,
    );
    const out = JSON.parse(await tool("skill_promote").run({ name: "deploy-runbook" }, ctx)) as {
      requested: boolean;
      skillId: string;
    };
    expect(out.requested).toBe(true);
    const inbox = ctx.db
      .prepare("SELECT kind, payload_json FROM inbox_items WHERE company_id = 'c1'")
      .all() as Array<{ kind: string; payload_json: string }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.kind).toBe("skill_promotion_requested");
    expect(JSON.parse(inbox[0]!.payload_json) as { skillId: string }).toEqual({
      skillId: out.skillId,
    });
  });

  it("rejects promoting a skill that does not exist", async () => {
    await expect(tool("skill_promote").run({ name: "nope" }, newCtx())).rejects.toThrow(
      /not found/i,
    );
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @prospero/shared test`
Expected: FAIL — the `memory` capability has 10 tools but the catalog still lists 9 / the toContain assertion fails. (Step 1 fixes the catalog; if Step 1 is already applied this passes — run after Step 5.)

Run: `pnpm --filter @prospero/main exec vitest run src/mcp/tools-memory.test.ts`
Expected: FAIL — `tool("skill_promote")` throws "not in memoryToolDefinitions".

- [ ] **Step 5: Add the `skill_promote` tool**

In `apps/main/src/mcp/tools-memory.ts`:

- Add an import for the inbox repository at the top, next to the other repository imports:

```typescript
import { createInboxRepository } from "../inbox/repository.js";
```

- Add this tool object before the `memoryToolDefinitions` export (after `skillUpdate`):

```typescript
const skillPromote: Tool = {
  name: "skill_promote",
  description:
    "Request that one of your private skills be promoted to company-shared, so other agents inherit it. Files a request for the user to review and approve — it does NOT promote the skill immediately.",
  inputSchema: z.object({ name: z.string().min(1).max(120) }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { name } = skillPromote.inputSchema.parse(input) as { name: string };
    const skill = createSkillsRepository(ctx.db).getByName(ctx.companyId, ctx.agentId, name);
    if (skill === null) throw new Error(`private skill not found: ${name}`);
    if (skill.agentId === null) {
      throw new Error(`skill "${name}" is already company-shared`);
    }
    if (!skillWriteLimiter.tryConsume(ctx.agentId)) {
      throw new Error("skill write rate limit exceeded — try again shortly");
    }
    createInboxRepository(ctx.db).create({
      companyId: ctx.companyId,
      kind: "skill_promotion_requested",
      actorId: ctx.agentId,
      title: `Skill promotion requested: ${skill.name}`,
      preview: skill.description,
      requiresAction: true,
      payloadJson: JSON.stringify({ skillId: skill.id }),
    });
    return JSON.stringify({ requested: true, skillId: skill.id });
  },
};
```

- Add `skillPromote` to the `memoryToolDefinitions` array (after `skillUpdate`).

> `skillWriteLimiter` and the `Tool` type already exist in this file (PR-C). `createSkillsRepository` is already imported.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @prospero/shared test`
Expected: PASS

Run: `pnpm --filter @prospero/main exec vitest run src/mcp/tools-memory.test.ts`
Expected: PASS — including the 2 new `skill_promote` tests.

Run: `pnpm typecheck`
Expected: PASS

> The MCP-server tool-registration test (`apps/main/tests/mcp.tools.test.ts` or similar) may assert a total tool count — if a test fails on a count, update the expected number by +1. Run `pnpm --filter @prospero/main test` for the `mcp` tests if unsure.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/capabilities.ts packages/shared/tests/capabilities.test.ts apps/main/src/mcp/tools-memory.ts apps/main/src/mcp/tools-memory.test.ts
git commit -m "feat(m11): add the skill_promote mcp tool"
```

---

## Task 5: Promotion-approval IPC handler

The user's approval performs the actual promotion. A `SKILL_PROMOTE_APPROVE` channel + an `approveSkillPromotion` handler in `learning-handlers.ts` + the preload bridge.

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/tests/ipc-channels.test.ts`
- Modify: `apps/main/src/ipc/learning-handlers.ts`
- Modify: `apps/main/tests/ipc.learning-handlers.test.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Add the channel + test**

In `packages/shared/src/ipc-channels.ts`, add inside the `IPC` object before `} as const;`:

```typescript
  SKILL_PROMOTE_APPROVE: "skills:promote-approve",
```

In `packages/shared/tests/ipc-channels.test.ts`, add inside `describe("IPC channels", ...)`:

```typescript
  it("exposes the M11 skill-promote-approve channel", () => {
    expect(IPC.SKILL_PROMOTE_APPROVE).toBe("skills:promote-approve");
  });
```

- [ ] **Step 2: Write the failing handler test**

In `apps/main/tests/ipc.learning-handlers.test.ts`, append a new `describe` block (the file has a `seed()` helper + a `USERDATA` const from PR-D2):

```typescript
describe("learningHandlers — skill promotion", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
  });

  it("approveSkillPromotion promotes the skill and resolves the inbox item", () => {
    const skills = createSkillsRepository(db);
    const skill = skills.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const inbox = createInboxRepository(db);
    inbox.create({
      companyId: "c1",
      kind: "skill_promotion_requested",
      title: "Promote deploy",
      requiresAction: true,
      payloadJson: JSON.stringify({ skillId: skill.id }),
    });
    const h = learningHandlers(db, USERDATA);
    const result = h.approveSkillPromotion({ skillId: skill.id, appliesToRole: "engineer" });
    expect(result.agentId).toBeNull();
    expect(result.promoted).toBe(true);
    expect(result.appliesToRole).toBe("engineer");
    const unread = (
      db.prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE read_at IS NULL").get() as {
        n: number;
      }
    ).n;
    expect(unread).toBe(0);
  });

  it("approveSkillPromotion accepts a null role (company-global)", () => {
    const skill = createSkillsRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const result = learningHandlers(db, USERDATA).approveSkillPromotion({
      skillId: skill.id,
      appliesToRole: null,
    });
    expect(result.appliesToRole).toBeNull();
  });
});
```

Add the `createInboxRepository` import to the test file's imports:

```typescript
import { createInboxRepository } from "../src/inbox/repository.js";
```

(`createSkillsRepository` is already imported in this file.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: FAIL — `h.approveSkillPromotion` is not a function.

- [ ] **Step 4: Add the handler**

In `apps/main/src/ipc/learning-handlers.ts`:

- Add to the `@prospero/shared` type import — `Skill` is already imported.
- Add this import after the existing `acceptSkillCandidate` import:

```typescript
import { createInboxRepository } from "../inbox/repository.js";
```

- Add to the `LearningHandlers` type, after `rejectCandidate`:

```typescript
  // Approve a pending skill-promotion request: promotes the skill to
  // company-shared (optionally role-scoped) and resolves its inbox item.
  approveSkillPromotion(args: { skillId: string; appliesToRole: string | null }): Skill;
```

- Add the method to the returned object, after `rejectCandidate`:

```typescript
    approveSkillPromotion({ skillId, appliesToRole }) {
      const skill = createSkillsRepository(db).promote(skillId, appliesToRole);
      createInboxRepository(db).markReadByCandidateId(skillId);
      return skill;
    },
```

> `markReadByCandidateId` (added in PR-D2) matches any inbox item whose `payload_json` contains the given id — the `skill_promotion_requested` item embeds `{ skillId }`, and the method's `LIKE '%id%'` substring match finds it regardless of the JSON key name. It is `kind`-filtered to `skill_candidate_pending` though — so it will NOT match a `skill_promotion_requested` item. **Therefore: do not reuse `markReadByCandidateId`.** Instead, add a generic helper. Replace the method body above with:

```typescript
    approveSkillPromotion({ skillId, appliesToRole }) {
      const skill = createSkillsRepository(db).promote(skillId, appliesToRole);
      const inboxRow = db
        .prepare(
          `SELECT id FROM inbox_items
            WHERE kind = 'skill_promotion_requested' AND read_at IS NULL AND payload_json LIKE ?
            LIMIT 1`,
        )
        .get(`%${skillId}%`) as { id: string } | undefined;
      if (inboxRow !== undefined) createInboxRepository(db).markRead(inboxRow.id);
      return skill;
    },
```

- In `registerLearningHandlers`, add the channel registration after the `SKILL_CANDIDATE_REJECT` handler:

```typescript
  ipcMain.handle(
    IPC.SKILL_PROMOTE_APPROVE,
    (_e, args: { skillId: string; appliesToRole: string | null }) =>
      h.approveSkillPromotion(args),
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: PASS

Run: `pnpm --filter @prospero/shared test`
Expected: PASS (the channel test)

- [ ] **Step 6: Add the preload bridge + `env.d.ts`**

In `apps/main/src/ipc/preload.ts`, inside the `learning: { ... }` namespace, after `rejectCandidate`, add:

```typescript
    approveSkillPromotion: (input: { skillId: string; appliesToRole: string | null }) =>
      ipcRenderer.invoke(IPC.SKILL_PROMOTE_APPROVE, input) as Promise<Skill>,
```

In `apps/renderer/src/env.d.ts`, inside the `learning: { ... }` interface, after `rejectCandidate`, add:

```typescript
        approveSkillPromotion: (input: {
          skillId: string;
          appliesToRole: string | null;
        }) => Promise<Skill>;
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS

```bash
git add packages/shared/src/ipc-channels.ts packages/shared/tests/ipc-channels.test.ts apps/main/src/ipc/learning-handlers.ts apps/main/tests/ipc.learning-handlers.test.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m11): add the skill-promotion approval handler"
```

---

## Task 6: Promotion review modal + Inbox wiring

A `skill_promotion_requested` inbox item gets a "Review" button that opens a modal — the skill body preview + a role picker — and an Approve action.

**Files:**
- Create: `apps/renderer/src/components/inbox/SkillPromotionModal.tsx`
- Modify: `apps/renderer/src/routes/Inbox.tsx`
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 1: Add the parity check (failing test first)**

In `apps/renderer/src/i18n/parity.test.ts`, add at the end of the `describe("i18n parity", ...)` block:

```typescript
  it("includes the M11 PR-E skill-promotion keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "inbox.skillPromotion.review",
      "inbox.skillPromotion.title",
      "inbox.skillPromotion.roleLabel",
      "inbox.skillPromotion.allRoles",
      "inbox.skillPromotion.approve",
      "inbox.skillPromotion.cancel",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
```

- [ ] **Step 2: Run the parity test to verify it fails**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: FAIL — the new keys are missing.

- [ ] **Step 3: Add the i18n keys**

In `apps/renderer/src/i18n/pt-BR.json`, find the `inbox` object and add a `skillPromotion` block inside it (after any existing child; mind the trailing comma):

```json
  "skillPromotion": {
   "review": "Revisar",
   "title": "Promover skill para a empresa",
   "roleLabel": "Disponível para",
   "allRoles": "Todos os papéis",
   "approve": "Aprovar promoção",
   "cancel": "Cancelar"
  }
```

In `apps/renderer/src/i18n/en-US.json`, mirror it inside the `inbox` object:

```json
  "skillPromotion": {
   "review": "Review",
   "title": "Promote skill to the company",
   "roleLabel": "Available to",
   "allRoles": "All roles",
   "approve": "Approve promotion",
   "cancel": "Cancel"
  }
```

- [ ] **Step 4: Run the parity test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS

- [ ] **Step 5: Create the `SkillPromotionModal`**

Create `apps/renderer/src/components/inbox/SkillPromotionModal.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  skillId: string;
  onClose: () => void;
  onApproved: () => void;
}

// Reviews a pending skill-promotion request: shows the skill body and lets the
// user scope the promoted skill to a role (or leave it company-global).
export const SkillPromotionModal: FC<Props> = ({ skillId, onClose, onApproved }) => {
  const { t } = useTranslation();
  const [body, setBody] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [role, setRole] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { body: b } = await window.prospero.learning.readSkillBody(skillId);
        setBody(b);
      } catch {
        setBody("");
      }
      const roleTemplates = await window.prospero.roles.list();
      setRoles(roleTemplates.map((r) => r.id));
    })();
  }, [skillId]);

  const approve = (): void => {
    setBusy(true);
    void (async () => {
      try {
        await window.prospero.learning.approveSkillPromotion({
          skillId,
          appliesToRole: role === "" ? null : role,
        });
        onApproved();
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface border border-surface-border rounded-lg w-[32rem] max-w-[90vw] p-5">
        <h2 className="text-sm font-semibold text-ink mb-3">
          {t("inbox.skillPromotion.title")}
        </h2>
        <pre className="text-xs text-ink-muted whitespace-pre-wrap font-mono max-h-60 overflow-auto bg-surface-soft rounded p-2.5">
          {body ?? "…"}
        </pre>
        <label className="block text-xs text-ink-muted mt-3 mb-1">
          {t("inbox.skillPromotion.roleLabel")}
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full text-sm px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
        >
          <option value="">{t("inbox.skillPromotion.allRoles")}</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="flex gap-2 mt-4 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded"
          >
            {t("inbox.skillPromotion.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={approve}
            className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded disabled:opacity-50"
          >
            {t("inbox.skillPromotion.approve")}
          </button>
        </div>
      </div>
    </div>
  );
};
```

> `window.prospero.roles.list()` returns `Array<RoleTemplate & { agentCount: number }>` — each has an `id` (verified in `env.d.ts`). `readSkillBody` and `approveSkillPromotion` are on `window.prospero.learning`.

- [ ] **Step 6: Wire the modal into `Inbox.tsx`**

In `apps/renderer/src/routes/Inbox.tsx`:

- Add the import:

```typescript
import { SkillPromotionModal } from "../components/inbox/SkillPromotionModal.js";
```

- Add modal state inside the `Inbox` component (next to its other `useState` calls):

```typescript
  const [promotionSkillId, setPromotionSkillId] = useState<string | null>(null);
```

- The file has a helper that extracts an id from `payloadJson` for goal kinds (`extractGoalId`). Add a small inline extractor — inside the component or as a module helper:

```typescript
const extractSkillId = (payloadJson: string | null): string | null => {
  if (payloadJson === null) return null;
  try {
    const p = JSON.parse(payloadJson) as { skillId?: unknown };
    return typeof p.skillId === "string" ? p.skillId : null;
  } catch {
    return null;
  }
};
```

- In the per-item render, add a "Review" button for `skill_promotion_requested` items that have not been read. Place it alongside the existing per-kind action blocks (e.g. next to the `approval` action block):

```tsx
              {item.kind === "skill_promotion_requested" &&
                item.readAt === null &&
                (() => {
                  const sid = extractSkillId(item.payloadJson);
                  if (sid === null) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setPromotionSkillId(sid)}
                      className="mt-2 text-xs text-brand hover:underline"
                    >
                      {t("inbox.skillPromotion.review")}
                    </button>
                  );
                })()}
```

- Render the modal once, near the end of the component's JSX (before the closing tag of the root element):

```tsx
      {promotionSkillId !== null && (
        <SkillPromotionModal
          skillId={promotionSkillId}
          onClose={() => setPromotionSkillId(null)}
          onApproved={() => {
            setPromotionSkillId(null);
            void refresh();
          }}
        />
      )}
```

> The Inbox reads items from `useInboxStore`. After approval the handler marks the inbox item read; the modal's `onApproved` must refresh the inbox view. If the store exposes a `refresh`/`load` action use it; if the store auto-refreshes via an `inbox:update` broadcast, `onApproved` can just close the modal. Inspect `apps/renderer/src/stores/inbox.ts` (or wherever `useInboxStore` lives) and use whatever refresh mechanism the existing `approval` resolve flow uses — mirror that. If the existing approve flow calls a store method to reload, call the same one in `onApproved`.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 8: Full verification**

Run: `pnpm test`
Expected: PASS — all prior tests plus the new repo, migration, capability, tool, handler, and parity tests; no regressions. If `agents-md-handlers.test.ts` times out under parallel load, re-run `pnpm test` once.

- [ ] **Step 9: Commit**

```bash
git add apps/renderer/src/components/inbox/SkillPromotionModal.tsx apps/renderer/src/routes/Inbox.tsx apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m11): add the skill-promotion review modal"
```

---

## Self-Review notes

- **Spec coverage (§1.2, §5, §6, §11 PR-E):** role-based inheritance into the system prompt (descending flow) → Tasks 1-2 (`listCompanyGlobal` + `buildMemoryBlock` role-scoped); `skill_promote` MCP tool → Task 4; the `skill_promotion_requested` inbox + the approval modal with body preview + role picker (ascending flow) → Tasks 3, 5, 6. **Deferred to PR-E2** (documented in "Decisions"): the `goal.achieved`→retrospective and `approval.rejected`→preference memory-derivation triggers; the `goal_retrospective_ready` inbox; the `/dashboard` "Org Learnings" card; the terminate-modal "promote private skills?" flow.
- **Placeholder scan:** Task 1 Step 1 contains a deliberately-flagged buggy snippet followed by the clean replacement and an explicit "delete those lines" instruction — the implementer uses the clean version. Every other code step is complete; commands have expected results. The one genuine investigation point (Task 6 Step 6, the inbox refresh mechanism) gives a concrete instruction: mirror the existing `approval` resolve flow's refresh.
- **Type consistency:** `Skill` is the return type of `skills.promote`, `approveSkillPromotion`, and the preload/`env.d.ts` `approveSkillPromotion` — consistent. `appliesToRole: string | null` is the same shape across `skills.promote`, the handler, the channel payload, the preload, and the modal (`role === "" ? null : role`). `listCompanyGlobal` is defined on both repos in Task 1 and consumed by `buildMemoryBlock` in Task 2. The `memory` capability gains exactly one tool (`skill_promote`, count 9→10) — Task 4 updates the catalog and its test together.
- **Correctness:** `skill_promote` does not mutate the skill (only files an inbox item) — spec §5. The approval is the sole mutation path (`skills.promote`). A promoted skill is already read-only to the agent (`skill_update` rejects `promoted` — PR-C). `markReadByCandidateId` is `kind`-filtered to `skill_candidate_pending` and would NOT match a promotion item — Task 5 Step 4 explicitly calls this out and uses a dedicated inline query instead.
- **Non-regression:** the role-inheritance change is a *correctness* improvement (role-scoped skills no longer leak cross-role) — the only behavior change is that an agent stops seeing other roles' company-shared skills in its prompt, which is the intended fix. `listCompanyShared`/`listCompanyWide` keep their semantics for the MCP tools. No agent-prompt size regression (the role-filtered set is a subset of what was loaded before). Migration `0020` follows the `0019` recreate-table pattern exactly. The `Record<InboxKind>` exhaustiveness break in `Inbox.tsx` is handled in Task 3 (the `KIND_BORDER` entry is added there to keep typecheck green between tasks).
- **Out of scope (PR-E2 and later):** memory-derivation triggers + Org Learnings card + terminate-modal promote (PR-E2); decay/trust + nudges + Settings + docs (PR-F).
