# M11 PR-D2 — Candidates review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the skill candidates that PR-D1's derivation engine produces actionable — a "Candidates" sub-tab in the agent Learning tab where the user can Accept, Edit, or Reject each pending candidate, with Accept turning it into a real skill.

**Architecture:** A 4th sub-tab in `LearningPanel`. Three IPC handlers on the existing `window.prospero.learning` namespace (`listCandidates`, `acceptCandidate`, `rejectCandidate`). The accept/reject workflow lives in a tested `review-candidate.ts` module: accepting a candidate writes its `SKILL.md` file, creates the `skills` row, marks the candidate `accepted`, and resolves its `skill_candidate_pending` inbox item; rejecting marks it `rejected` and resolves the inbox item. Accept and Edit are the same IPC — Edit just supplies overridden name/description/body.

**Tech Stack:** TypeScript, better-sqlite3, Electron IPC, React, react-i18next, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md` §10 (UI — the Candidates sub-tab), §11 PR-D.

## Decisions locked for this plan

- **PR-D2 ships the Candidates review feature only. Nudges are deferred.** The spec §7 / §11 PR-D also lists a "nudges fallback" with three triggers (turn-complete heuristic, time-based, compaction). The **compaction trigger is impossible today** — there is no M9 compaction event anywhere in the codebase (`grep compact` → 0 hits; the `ParsedEvent` union has no compaction kind). The remaining heuristic is token-sensitive (every nudge injects a turn — `feedback_token_efficiency`) and under-specified (it depends on per-issue derivation tracking the orchestrator does not have). Bundling a partial, fuzzy nudge implementation would dilute an otherwise clean, well-specified PR. Nudges move to a later PR (PR-F, or once M9 compaction exists). The roadmap PR-D2/PR-F rows get corrected at PR-D2 close-out.
- **Accept and Edit are one IPC.** `acceptCandidate({ candidateId, name?, description?, body? })` — when the optional overrides are present (the Edit flow) they replace the proposed values; when absent (plain Accept) the proposed values are used.
- **Accept does not re-sanitize the body.** The candidate body was already sanitized by the PR-D1 worker. If the user edited it, the user is the trusted human reviewer — re-sanitizing user edits would be wrong (a skill *about* prompt-injection defense could legitimately contain trigger phrases). The human review IS the trust gate.
- **The Candidates sub-tab shows only PENDING candidates for the current agent** (`listPendingByAgent`). Once accepted or rejected a candidate leaves the queue.
- **On accept/reject, the candidate's `skill_candidate_pending` inbox item is marked read** — found by a `payload_json` substring match on the candidate id (the PR-D1 worker writes `payloadJson: JSON.stringify({ candidateId })`).
- **Skill `source` is mapped from the candidate trigger:** `issue_done` → `derived_from_issue`, `recovery` → `derived_from_recovery`.
- **A name collision on accept surfaces as an error.** The `skills` table has a unique index on `(company_id, agent_id, name)`; an accept whose name already exists throws, the IPC rejects, and the Candidates card shows an error — the user can then Edit the name and retry. No pre-check. (A failed accept may leave an orphan `SKILL.md` file with no DB row — harmless; not worth cleanup code.)
- **No reject-reason input in the PR-D2 UI.** `rejectCandidate` accepts an optional `reason` (persisted to `skill_candidates.reject_reason`), but the card's Reject button sends none — keeps the card simple. A reason input is a possible later polish.
- **The header `🎓` badge / Skills sub-tab refresh on agent navigation, not live.** Accepting a candidate creates a skill; `Agent.tsx` re-fetches skills on agent/tab change (PR-C-UI), so the new skill shows on next Learning-tab entry. A live cross-sub-tab refresh is out of scope.

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/ipc-channels.ts` (modify) | 3 new channel constants |
| `packages/shared/tests/ipc-channels.test.ts` (modify) | assert the 3 channels |
| `apps/main/src/memory/skill-candidates-repository.ts` (modify) | `listPendingByAgent` query |
| `apps/main/src/inbox/repository.ts` (modify) | `markReadByCandidateId` |
| `apps/main/src/memory/review-candidate.ts` (create) | `acceptSkillCandidate` / `rejectSkillCandidate` |
| `apps/main/src/memory/review-candidate.test.ts` (create) | review workflow test |
| `apps/main/src/ipc/learning-handlers.ts` (modify) | 3 handlers; `userDataDir` param |
| `apps/main/tests/ipc.learning-handlers.test.ts` (modify) | handler tests + `userDataDir` call-site update |
| `apps/main/src/ipc/preload.ts` (modify) | 3 `learning` bridge methods |
| `apps/renderer/src/env.d.ts` (modify) | `learning` typed surface |
| `apps/renderer/src/i18n/pt-BR.json` (modify) | candidates keys (PT) |
| `apps/renderer/src/i18n/en-US.json` (modify) | candidates keys (EN) |
| `apps/renderer/src/i18n/parity.test.ts` (modify) | M11 candidates parity check |
| `apps/renderer/src/components/agent-panel/LearningPanel.tsx` (modify) | `CandidatesView` + 4th sub-tab |

Dependencies: Task 1 independent. Task 2 depends on Task 1 (`listPendingByAgent` not needed by Task 2, but `markReadByCandidateId` is added in Task 2). Task 3 depends on Tasks 1-2. Task 4 depends on Tasks 1-3. Task 5 independent. Task 6 depends on Tasks 4-5.

---

## Task 1: IPC channels + `listPendingByAgent`

Three new IPC channels and a repository query that lists an agent's pending skill candidates.

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/tests/ipc-channels.test.ts`
- Modify: `apps/main/src/memory/skill-candidates-repository.ts`

- [ ] **Step 1: Write the failing channel test**

In `packages/shared/tests/ipc-channels.test.ts`, add this `it` block inside the `describe("IPC channels", ...)` block, after the "M11 learning channels" test:

```typescript
  it("exposes the M11 skill-candidate channels", () => {
    expect(IPC.SKILL_CANDIDATES_LIST_FOR_AGENT).toBe("skill-candidates:list-for-agent");
    expect(IPC.SKILL_CANDIDATE_ACCEPT).toBe("skill-candidates:accept");
    expect(IPC.SKILL_CANDIDATE_REJECT).toBe("skill-candidates:reject");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/shared test`
Expected: FAIL — `IPC.SKILL_CANDIDATES_LIST_FOR_AGENT` is `undefined`.

- [ ] **Step 3: Add the channel constants**

In `packages/shared/src/ipc-channels.ts`, add these three lines inside the `IPC` object literal, immediately before the closing `} as const;` (after `SESSION_SEARCH`):

```typescript
  SKILL_CANDIDATES_LIST_FOR_AGENT: "skill-candidates:list-for-agent",
  SKILL_CANDIDATE_ACCEPT: "skill-candidates:accept",
  SKILL_CANDIDATE_REJECT: "skill-candidates:reject",
```

- [ ] **Step 4: Write the failing repository test**

In `apps/main/src/memory/skill-candidates-repository.test.ts` — if the file does not exist, create it with the content below; if it exists, add the `it` block to the existing top-level `describe`. Full file content if creating it:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createSkillCandidatesRepository } from "./skill-candidates-repository.js";

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0),
            ('a2','c1','Des','designer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  db.prepare(
    `INSERT INTO activity_events (id, company_id, actor_kind, actor_id, action, entity_kind,
       entity_id, agent_id, payload_json, created_at)
     VALUES ('evt_1','c1','agent','a1','issue.status_changed','issue','i1','a1','{}',0),
            ('evt_2','c1','agent','a2','issue.status_changed','issue','i2','a2','{}',0)`,
  ).run();
  return db;
};

describe("skill-candidates-repository listPendingByAgent", () => {
  it("returns only the given agent's pending candidates, newest first", () => {
    const db = seed();
    const repo = createSkillCandidatesRepository(db);
    const a = repo.create({
      companyId: "c1",
      agentId: "a1",
      sourceEventId: "evt_1",
      trigger: "issue_done",
      proposedName: "older",
      proposedDescription: "d",
      proposedBody: "b",
    });
    const b = repo.create({
      companyId: "c1",
      agentId: "a1",
      sourceEventId: "evt_1",
      trigger: "issue_done",
      proposedName: "newer",
      proposedDescription: "d",
      proposedBody: "b",
    });
    repo.create({
      companyId: "c1",
      agentId: "a2",
      sourceEventId: "evt_2",
      trigger: "issue_done",
      proposedName: "other-agent",
      proposedDescription: "d",
      proposedBody: "b",
    });
    repo.updateStatus(a.id, "accepted", "user");
    const pending = repo.listPendingByAgent("a1");
    expect(pending.map((c) => c.proposedName)).toEqual(["newer"]);
    expect(pending[0]?.id).toBe(b.id);
  });
});
```

> `repo.create` rows get a strictly increasing `created_at` (`Date.now()`); the `ORDER BY created_at DESC` test relies on `b` being created after `a`. If the two creates land in the same millisecond and the order is flaky, the test still passes because `a` is `accepted` (filtered out) — only `b` remains. The ordering is still asserted correctly for the single-row result.

- [ ] **Step 5: Run the repo test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/skill-candidates-repository.test.ts`
Expected: FAIL — `repo.listPendingByAgent` is not a function.

- [ ] **Step 6: Add `listPendingByAgent`**

In `apps/main/src/memory/skill-candidates-repository.ts`:

- Add to the `SkillCandidatesRepository` type, after the `listPending` line:

```typescript
  listPendingByAgent(agentId: string): SkillCandidate[];
```

- Add the prepared statement next to the existing `pending` statement:

```typescript
  const pendingByAgent = db.prepare(
    "SELECT * FROM skill_candidates WHERE agent_id = ? AND status = 'pending' ORDER BY created_at DESC",
  );
```

- Add the method to the returned object, after `listPending`:

```typescript
    listPendingByAgent(agentId) {
      return (pendingByAgent.all(agentId) as SkillCandidateRow[]).map(rowToCandidate);
    },
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @prospero/shared test`
Expected: PASS

Run: `pnpm --filter @prospero/main exec vitest run src/memory/skill-candidates-repository.test.ts`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/ipc-channels.ts packages/shared/tests/ipc-channels.test.ts apps/main/src/memory/skill-candidates-repository.ts apps/main/src/memory/skill-candidates-repository.test.ts
git commit -m "feat(m11): add skill-candidate ipc channels and listPendingByAgent"
```

---

## Task 2: `review-candidate.ts` — accept / reject workflow

The accept/reject logic: `acceptSkillCandidate` writes the `SKILL.md`, creates the `skills` row, marks the candidate accepted, and resolves the inbox item. `rejectSkillCandidate` marks the candidate rejected and resolves the inbox item. Both depend on a new `markReadByCandidateId` on the inbox repository.

**Files:**
- Modify: `apps/main/src/inbox/repository.ts`
- Create: `apps/main/src/memory/review-candidate.ts`
- Create: `apps/main/src/memory/review-candidate.test.ts`

- [ ] **Step 1: Add `markReadByCandidateId` to the inbox repository**

In `apps/main/src/inbox/repository.ts`:

- Add to the `InboxRepository` type, after `markReadByApprovalId`:

```typescript
  markReadByCandidateId(candidateId: string): void;
```

- Add the method to the returned object, after `markReadByApprovalId`:

```typescript
    markReadByCandidateId(candidateId) {
      // skill_candidate_pending items embed { candidateId } in payload_json.
      // A naive substring match is adequate for v1 inbox sizes.
      const row = db
        .prepare(
          `SELECT id FROM inbox_items
            WHERE kind = 'skill_candidate_pending' AND read_at IS NULL AND payload_json LIKE ?
            LIMIT 1`,
        )
        .get(`%${candidateId}%`) as { id: string } | undefined;
      if (row !== undefined) markReadStmt.run(Date.now(), row.id);
    },
```

- [ ] **Step 2: Write the failing test**

Create `apps/main/src/memory/review-candidate.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../db/migrations.js";
import { createSkillCandidatesRepository } from "./skill-candidates-repository.js";
import { createSkillsRepository } from "./skills-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { acceptSkillCandidate, rejectSkillCandidate } from "./review-candidate.js";

let userDataDir: string;

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  db.prepare(
    `INSERT INTO activity_events (id, company_id, actor_kind, actor_id, action, entity_kind,
       entity_id, agent_id, payload_json, created_at)
     VALUES ('evt_1','c1','agent','a1','issue.status_changed','issue','i1','a1','{}',0)`,
  ).run();
  return db;
};

// Creates a pending candidate + its inbox item; returns the candidate id.
const seedCandidate = (db: Database.Database): string => {
  const candidate = createSkillCandidatesRepository(db).create({
    companyId: "c1",
    agentId: "a1",
    sourceEventId: "evt_1",
    trigger: "issue_done",
    proposedName: "redis-pool-tuning",
    proposedDescription: "how to raise the pool",
    proposedBody: "1. measure\n2. raise",
  });
  createInboxRepository(db).create({
    companyId: "c1",
    kind: "skill_candidate_pending",
    title: "New skill candidate",
    requiresAction: true,
    payloadJson: JSON.stringify({ candidateId: candidate.id }),
  });
  return candidate.id;
};

const inboxUnreadCount = (db: Database.Database): number =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE read_at IS NULL")
      .get() as { n: number }
  ).n;

describe("acceptSkillCandidate", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
    userDataDir = mkdtempSync(join(tmpdir(), "prospero-rc-"));
  });

  it("creates a skill, writes the SKILL.md, marks the candidate accepted, resolves the inbox", () => {
    const candidateId = seedCandidate(db);
    const skill = acceptSkillCandidate(db, userDataDir, { candidateId, reviewedBy: "user" });
    expect(skill.name).toBe("redis-pool-tuning");
    expect(skill.source).toBe("derived_from_issue");
    expect(skill.agentId).toBe("a1");
    expect(readFileSync(skill.bodyPath, "utf8")).toContain("2. raise");
    expect(createSkillsRepository(db).getById(skill.id)?.description).toBe(
      "how to raise the pool",
    );
    expect(createSkillCandidatesRepository(db).getById(candidateId)?.status).toBe("accepted");
    expect(inboxUnreadCount(db)).toBe(0);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("applies name/description/body overrides (the Edit flow)", () => {
    const candidateId = seedCandidate(db);
    const skill = acceptSkillCandidate(db, userDataDir, {
      candidateId,
      reviewedBy: "user",
      name: "edited-name",
      description: "edited desc",
      body: "edited body",
    });
    expect(skill.name).toBe("edited-name");
    expect(skill.description).toBe("edited desc");
    expect(readFileSync(skill.bodyPath, "utf8")).toBe("edited body");
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("throws for an unknown candidate", () => {
    expect(() =>
      acceptSkillCandidate(db, userDataDir, { candidateId: "cand_missing", reviewedBy: "user" }),
    ).toThrow(/not found/i);
  });

  it("throws when the candidate is already reviewed", () => {
    const candidateId = seedCandidate(db);
    acceptSkillCandidate(db, userDataDir, { candidateId, reviewedBy: "user" });
    expect(() =>
      acceptSkillCandidate(db, userDataDir, { candidateId, reviewedBy: "user" }),
    ).toThrow(/already/i);
  });
});

describe("rejectSkillCandidate", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
  });

  it("marks the candidate rejected, stores the reason, and resolves the inbox", () => {
    const candidateId = seedCandidate(db);
    rejectSkillCandidate(db, { candidateId, reviewedBy: "user", reason: "too narrow" });
    const candidate = createSkillCandidatesRepository(db).getById(candidateId);
    expect(candidate?.status).toBe("rejected");
    expect(candidate?.rejectReason).toBe("too narrow");
    expect(inboxUnreadCount(db)).toBe(0);
  });

  it("throws when the candidate is already reviewed", () => {
    const candidateId = seedCandidate(db);
    rejectSkillCandidate(db, { candidateId, reviewedBy: "user" });
    expect(() => rejectSkillCandidate(db, { candidateId, reviewedBy: "user" })).toThrow(
      /already/i,
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/review-candidate.test.ts`
Expected: FAIL — module `./review-candidate.js` not found.

- [ ] **Step 4: Create `review-candidate.ts`**

Create `apps/main/src/memory/review-candidate.ts`:

```typescript
import type Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Skill, SkillSource } from "@prospero/shared";
import { createSkillCandidatesRepository } from "./skill-candidates-repository.js";
import { createSkillsRepository } from "./skills-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { getAgentMemoryDir, skillBodyPath } from "./memory-dir.js";

// Maps the candidate's derivation trigger to the resulting skill's source.
const SOURCE_BY_TRIGGER: Record<"issue_done" | "recovery", SkillSource> = {
  issue_done: "derived_from_issue",
  recovery: "derived_from_recovery",
};

export type AcceptCandidateInput = {
  candidateId: string;
  reviewedBy: string;
  // Optional overrides — the "Edit" flow. Omitted fields fall back to the
  // candidate's proposed values.
  name?: string;
  description?: string;
  body?: string;
};

// Accepts a pending skill candidate: writes its SKILL.md, creates the skills
// row, marks the candidate accepted, and resolves its inbox item. Throws if
// the candidate is missing or already reviewed, or (via the skills unique
// index) if a skill with that name already exists for the agent.
export const acceptSkillCandidate = (
  db: Database.Database,
  userDataDir: string,
  input: AcceptCandidateInput,
): Skill => {
  const candidatesRepo = createSkillCandidatesRepository(db);
  const candidate = candidatesRepo.getById(input.candidateId);
  if (candidate === null) throw new Error(`skill candidate not found: ${input.candidateId}`);
  if (candidate.status !== "pending") {
    throw new Error(`skill candidate already ${candidate.status}`);
  }
  const name = (input.name ?? candidate.proposedName).trim();
  const description = (input.description ?? candidate.proposedDescription).trim();
  const body = input.body ?? candidate.proposedBody;
  if (name === "" || description === "" || body.trim() === "") {
    throw new Error("skill name, description, and body are all required");
  }
  const scopeDir = getAgentMemoryDir(userDataDir, candidate.companyId, candidate.agentId);
  const bodyPath = skillBodyPath(scopeDir, name);
  mkdirSync(dirname(bodyPath), { recursive: true });
  writeFileSync(bodyPath, body, "utf8");
  const skill = createSkillsRepository(db).create({
    companyId: candidate.companyId,
    agentId: candidate.agentId,
    name,
    bodyPath,
    description,
    source: SOURCE_BY_TRIGGER[candidate.trigger],
  });
  candidatesRepo.updateStatus(input.candidateId, "accepted", input.reviewedBy);
  createInboxRepository(db).markReadByCandidateId(input.candidateId);
  return skill;
};

export type RejectCandidateInput = {
  candidateId: string;
  reviewedBy: string;
  reason?: string;
};

// Rejects a pending skill candidate and resolves its inbox item. Throws if the
// candidate is missing or already reviewed.
export const rejectSkillCandidate = (
  db: Database.Database,
  input: RejectCandidateInput,
): void => {
  const candidatesRepo = createSkillCandidatesRepository(db);
  const candidate = candidatesRepo.getById(input.candidateId);
  if (candidate === null) throw new Error(`skill candidate not found: ${input.candidateId}`);
  if (candidate.status !== "pending") {
    throw new Error(`skill candidate already ${candidate.status}`);
  }
  candidatesRepo.updateStatus(input.candidateId, "rejected", input.reviewedBy, input.reason);
  createInboxRepository(db).markReadByCandidateId(input.candidateId);
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/memory/review-candidate.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/inbox/repository.ts apps/main/src/memory/review-candidate.ts apps/main/src/memory/review-candidate.test.ts
git commit -m "feat(m11): add skill-candidate accept/reject workflow"
```

---

## Task 3: Learning IPC handlers

`learningHandlers` gains three methods. Because `acceptCandidate` needs a `userData` path, the factory takes a `userDataDir` argument; `registerLearningHandlers` resolves it from Electron's `app`.

**Files:**
- Modify: `apps/main/src/ipc/learning-handlers.ts`
- Modify: `apps/main/tests/ipc.learning-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/main/tests/ipc.learning-handlers.test.ts`:

First, add a shared `userData` temp dir. Add this import to the existing `node:fs` / `node:os` / `node:path` imports if not present (`mkdtempSync`, `tmpdir`, `join` are already imported) and add a module-level constant after the imports, before `const seed`:

```typescript
const USERDATA = mkdtempSync(join(tmpdir(), "prospero-lh-ud-"));
```

Then update **every** existing `learningHandlers(db)` call in the file to `learningHandlers(db, USERDATA)` (there are 8 — in the `learningHandlers` describe block).

Then append this new `describe` block at the end of the file:

```typescript
describe("learningHandlers — candidates", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
    db.prepare(
      `INSERT INTO activity_events (id, company_id, actor_kind, actor_id, action, entity_kind,
         entity_id, agent_id, payload_json, created_at)
       VALUES ('evt_1','c1','agent','a1','issue.status_changed','issue','i1','a1','{}',0)`,
    ).run();
  });

  const seedCandidate = (): string => {
    const candidate = createSkillCandidatesRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      sourceEventId: "evt_1",
      trigger: "issue_done",
      proposedName: "deploy-runbook",
      proposedDescription: "how to deploy",
      proposedBody: "1. build\n2. ship",
    });
    return candidate.id;
  };

  it("listCandidates returns the agent's pending candidates", () => {
    seedCandidate();
    const list = learningHandlers(db, USERDATA).listCandidates({ agentId: "a1" });
    expect(list).toHaveLength(1);
    expect(list[0]?.proposedName).toBe("deploy-runbook");
  });

  it("acceptCandidate creates a skill and clears the candidate from the pending list", () => {
    const candidateId = seedCandidate();
    const h = learningHandlers(db, USERDATA);
    const skill = h.acceptCandidate({ candidateId });
    expect(skill.name).toBe("deploy-runbook");
    expect(h.listCandidates({ agentId: "a1" })).toHaveLength(0);
    expect(h.listSkills({ agentId: "a1" }).map((s) => s.name)).toContain("deploy-runbook");
  });

  it("acceptCandidate applies overrides", () => {
    const candidateId = seedCandidate();
    const h = learningHandlers(db, USERDATA);
    const skill = h.acceptCandidate({ candidateId, name: "renamed-skill", body: "new body" });
    expect(skill.name).toBe("renamed-skill");
  });

  it("rejectCandidate clears the candidate from the pending list", () => {
    const candidateId = seedCandidate();
    const h = learningHandlers(db, USERDATA);
    expect(h.rejectCandidate({ candidateId })).toEqual({ ok: true });
    expect(h.listCandidates({ agentId: "a1" })).toHaveLength(0);
  });
});
```

Add the `createSkillCandidatesRepository` import to the test file's imports:

```typescript
import { createSkillCandidatesRepository } from "../src/memory/skill-candidates-repository.js";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: FAIL — `learningHandlers` takes 1 argument / `.listCandidates` does not exist.

- [ ] **Step 3: Extend `learning-handlers.ts`**

In `apps/main/src/ipc/learning-handlers.ts`:

- Change the electron import line `import { ipcMain } from "electron";` to:

```typescript
import { app, ipcMain } from "electron";
```

- Change the `@prospero/shared` type import to add `Skill` is already imported; add `SkillCandidate`:

```typescript
import type { Skill, Memory, SessionSearchHit, SenderKind, SkillCandidate } from "@prospero/shared";
```

- Add these imports after the `createMemoriesRepository` import:

```typescript
import { createSkillCandidatesRepository } from "../memory/skill-candidates-repository.js";
import { acceptSkillCandidate, rejectSkillCandidate } from "../memory/review-candidate.js";
```

- Add to the `LearningHandlers` type, after the `searchSessions` line:

```typescript
  // Pending skill candidates derived for the agent (PR-D auto-derivation).
  listCandidates(args: { agentId: string }): SkillCandidate[];
  // Accept a candidate → creates a real skill. Optional overrides = the Edit flow.
  acceptCandidate(args: {
    candidateId: string;
    name?: string;
    description?: string;
    body?: string;
  }): Skill;
  // Reject a candidate; optional reason is persisted.
  rejectCandidate(args: { candidateId: string; reason?: string }): { ok: true };
```

- Change the factory signature from `export const learningHandlers = (db: Database.Database): LearningHandlers => {` to:

```typescript
export const learningHandlers = (
  db: Database.Database,
  userDataDir: string,
): LearningHandlers => {
```

- Add these three methods to the returned object, after `searchSessions`:

```typescript
    listCandidates({ agentId }) {
      return createSkillCandidatesRepository(db).listPendingByAgent(agentId);
    },

    acceptCandidate({ candidateId, name, description, body }) {
      return acceptSkillCandidate(db, userDataDir, {
        candidateId,
        reviewedBy: "user",
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(body !== undefined ? { body } : {}),
      });
    },

    rejectCandidate({ candidateId, reason }) {
      rejectSkillCandidate(db, {
        candidateId,
        reviewedBy: "user",
        ...(reason !== undefined ? { reason } : {}),
      });
      return { ok: true };
    },
```

- Replace `registerLearningHandlers` entirely with:

```typescript
export const registerLearningHandlers = (db: Database.Database): void => {
  const h = learningHandlers(db, app.getPath("userData"));
  ipcMain.handle(IPC.SKILLS_LIST_FOR_AGENT, (_e, args: { agentId: string }) => h.listSkills(args));
  ipcMain.handle(IPC.SKILLS_READ_BODY, (_e, args: { skillId: string }) => h.readSkillBody(args));
  ipcMain.handle(IPC.MEMORIES_LIST_FOR_AGENT, (_e, args: { agentId: string }) =>
    h.listMemories(args),
  );
  ipcMain.handle(
    IPC.SESSION_SEARCH,
    (_e, args: { agentId: string; query: string; limit?: number }) => h.searchSessions(args),
  );
  ipcMain.handle(IPC.SKILL_CANDIDATES_LIST_FOR_AGENT, (_e, args: { agentId: string }) =>
    h.listCandidates(args),
  );
  ipcMain.handle(
    IPC.SKILL_CANDIDATE_ACCEPT,
    (_e, args: { candidateId: string; name?: string; description?: string; body?: string }) =>
      h.acceptCandidate(args),
  );
  ipcMain.handle(IPC.SKILL_CANDIDATE_REJECT, (_e, args: { candidateId: string; reason?: string }) =>
    h.rejectCandidate(args),
  );
};
```

> The `...(x !== undefined ? { x } : {})` spreads are required because the repo is built with `exactOptionalPropertyTypes` — assigning an explicit `undefined` to an optional field is a type error.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: PASS — the existing 12 tests (now calling `learningHandlers(db, USERDATA)`) plus the 4 new candidate tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/ipc/learning-handlers.ts apps/main/tests/ipc.learning-handlers.test.ts
git commit -m "feat(m11): add candidate list/accept/reject ipc handlers"
```

---

## Task 4: Preload bridge + renderer typed surface

Expose `listCandidates` / `acceptCandidate` / `rejectCandidate` on `window.prospero.learning`.

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Add `SkillCandidate` to the preload's shared import**

In `apps/main/src/ipc/preload.ts`, the `@prospero/shared` import block already imports `type Skill`, `type Memory`, `type SessionSearchHit`. Add one line:

```typescript
  type SkillCandidate,
```

- [ ] **Step 2: Add the three methods to the preload `learning` namespace**

In `apps/main/src/ipc/preload.ts`, inside the `learning: { ... }` object, after the `searchSessions` method, add:

```typescript
    listCandidates: (agentId: string) =>
      ipcRenderer.invoke(IPC.SKILL_CANDIDATES_LIST_FOR_AGENT, { agentId }) as Promise<
        SkillCandidate[]
      >,
    acceptCandidate: (input: {
      candidateId: string;
      name?: string;
      description?: string;
      body?: string;
    }) => ipcRenderer.invoke(IPC.SKILL_CANDIDATE_ACCEPT, input) as Promise<Skill>,
    rejectCandidate: (input: { candidateId: string; reason?: string }) =>
      ipcRenderer.invoke(IPC.SKILL_CANDIDATE_REJECT, input) as Promise<{ ok: true }>,
```

- [ ] **Step 3: Add `SkillCandidate` to `env.d.ts`**

In `apps/renderer/src/env.d.ts`, the `import type { ... } from "@prospero/shared"` block already imports `Skill`, `Memory`, `SessionSearchHit`. Add one line:

```typescript
  SkillCandidate,
```

- [ ] **Step 4: Add the three methods to the `env.d.ts` `learning` surface**

In `apps/renderer/src/env.d.ts`, inside the `learning: { ... }` interface block, after the `searchSessions` line, add:

```typescript
        listCandidates: (agentId: string) => Promise<SkillCandidate[]>;
        acceptCandidate: (input: {
          candidateId: string;
          name?: string;
          description?: string;
          body?: string;
        }) => Promise<Skill>;
        rejectCandidate: (input: { candidateId: string; reason?: string }) => Promise<{
          ok: true;
        }>;
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — `window.prospero.learning.listCandidates` / `.acceptCandidate` / `.rejectCandidate` are now typed.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m11): expose candidate review on the learning bridge"
```

---

## Task 5: i18n keys for the Candidates sub-tab

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 1: Add the parity check (failing test first)**

In `apps/renderer/src/i18n/parity.test.ts`, add this `it` block at the end of the `describe("i18n parity", ...)` block (before its closing `});`):

```typescript
  it("includes the M11 PR-D2 candidates keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "agent.learning.subtabs.candidates",
      "agent.learning.candidates.empty",
      "agent.learning.candidates.accept",
      "agent.learning.candidates.edit",
      "agent.learning.candidates.reject",
      "agent.learning.candidates.save",
      "agent.learning.candidates.cancel",
      "agent.learning.candidates.error",
      "agent.learning.candidates.trigger.issue_done",
      "agent.learning.candidates.trigger.recovery",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
```

- [ ] **Step 2: Run the parity test to verify it fails**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: FAIL — the new keys are missing in both locales.

- [ ] **Step 3: Add the keys to `pt-BR.json`**

In `apps/renderer/src/i18n/pt-BR.json`, inside the `agent.learning` object: add `"candidates": "Candidatos"` to the `subtabs` object (after `"history"`), and add a `candidates` block after the `history` block (insert a comma after the `history` block's closing brace):

In `subtabs`:
```json
   "subtabs": {
    "skills": "Skills",
    "memory": "Memória",
    "history": "Histórico",
    "candidates": "Candidatos"
   },
```

New `candidates` block (last entry inside `learning`, after `history`):
```json
   "candidates": {
    "empty": "Nenhum candidato a skill no momento.",
    "accept": "Aceitar",
    "edit": "Editar",
    "reject": "Rejeitar",
    "save": "Salvar e aceitar",
    "cancel": "Cancelar",
    "nameLabel": "Nome",
    "descriptionLabel": "Descrição",
    "bodyLabel": "Corpo (markdown)",
    "error": "Não foi possível processar — talvez já exista um skill com esse nome. Edite o nome e tente de novo.",
    "trigger": {
     "issue_done": "De um issue concluído",
     "recovery": "De uma recuperação de erro"
    }
   }
```

- [ ] **Step 4: Add the keys to `en-US.json`**

In `apps/renderer/src/i18n/en-US.json`, mirror the structure:

In `subtabs`:
```json
   "subtabs": {
    "skills": "Skills",
    "memory": "Memory",
    "history": "History",
    "candidates": "Candidates"
   },
```

New `candidates` block (last entry inside `learning`, after `history`):
```json
   "candidates": {
    "empty": "No skill candidates right now.",
    "accept": "Accept",
    "edit": "Edit",
    "reject": "Reject",
    "save": "Save & accept",
    "cancel": "Cancel",
    "nameLabel": "Name",
    "descriptionLabel": "Description",
    "bodyLabel": "Body (markdown)",
    "error": "Could not process — a skill with that name may already exist. Edit the name and retry.",
    "trigger": {
     "issue_done": "From a completed issue",
     "recovery": "From an error recovery"
    }
   }
```

> Both files use 1-space indentation — match it. If the pre-commit prettier hook reformats, that is fine.

- [ ] **Step 5: Run the parity test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS — including the "pt-BR and en-US expose the same key set" test.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m11): add candidates sub-tab i18n keys"
```

---

## Task 6: `CandidatesView` + wire the 4th sub-tab

Add the `candidates` sub-tab to `LearningPanel` and a `CandidatesView` component: a list of pending candidates, each with Accept / Edit / Reject. Edit turns the card into an inline form.

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/LearningPanel.tsx`

- [ ] **Step 1: Add `candidates` to the sub-tab type + array**

In `apps/renderer/src/components/agent-panel/LearningPanel.tsx`:

- Change the `SubTab` type:

```typescript
type SubTab = "skills" | "memory" | "history" | "candidates";
```

- Change the `SUB_TABS` array:

```typescript
const SUB_TABS: SubTab[] = ["skills", "memory", "history", "candidates"];
```

- Change the import on line 1-3 to add `useEffect` and the `SkillCandidate` type:

```typescript
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Skill, Memory, SessionSearchHit, SkillCandidate } from "@prospero/shared";
```

- In the sub-view render block, add the `candidates` branch after the `history` line:

```tsx
        {sub === "candidates" && <CandidatesView agentId={agentId} />}
```

- [ ] **Step 2: Add the `CandidatesView` component**

In `apps/renderer/src/components/agent-panel/LearningPanel.tsx`, append this component at the end of the file:

```tsx
// --- Candidates -----------------------------------------------------------

const CandidatesView: FC<{ agentId: string }> = ({ agentId }) => {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<SkillCandidate[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftBody, setDraftBody] = useState("");

  useEffect(() => {
    void (async () => {
      const list = await window.prospero.learning.listCandidates(agentId);
      setCandidates(list);
    })();
  }, [agentId]);

  const remove = (id: string): void => {
    setCandidates((cur) => (cur ?? []).filter((c) => c.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const accept = (
    c: SkillCandidate,
    overrides?: { name: string; description: string; body: string },
  ): void => {
    setBusyId(c.id);
    setErrorId(null);
    void (async () => {
      try {
        await window.prospero.learning.acceptCandidate({
          candidateId: c.id,
          ...(overrides ?? {}),
        });
        remove(c.id);
      } catch {
        setErrorId(c.id);
      } finally {
        setBusyId(null);
      }
    })();
  };

  const reject = (c: SkillCandidate): void => {
    setBusyId(c.id);
    setErrorId(null);
    void (async () => {
      try {
        await window.prospero.learning.rejectCandidate({ candidateId: c.id });
        remove(c.id);
      } catch {
        setErrorId(c.id);
      } finally {
        setBusyId(null);
      }
    })();
  };

  const startEdit = (c: SkillCandidate): void => {
    setEditingId(c.id);
    setErrorId(null);
    setDraftName(c.proposedName);
    setDraftDesc(c.proposedDescription);
    setDraftBody(c.proposedBody);
  };

  if (candidates === null) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">…</div>;
  }
  if (candidates.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">
        {t("agent.learning.candidates.empty")}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-surface-border">
      {candidates.map((c) => (
        <li key={c.id} className="px-6 py-3">
          {editingId === c.id ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t("agent.learning.candidates.nameLabel")}
                className="text-sm px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
              />
              <input
                type="text"
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder={t("agent.learning.candidates.descriptionLabel")}
                className="text-sm px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
              />
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder={t("agent.learning.candidates.bodyLabel")}
                rows={6}
                className="text-xs font-mono px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() =>
                    accept(c, { name: draftName, description: draftDesc, body: draftBody })
                  }
                  className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded disabled:opacity-50"
                >
                  {t("agent.learning.candidates.save")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded"
                >
                  {t("agent.learning.candidates.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">{c.proposedName}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
                  {t(`agent.learning.candidates.trigger.${c.trigger}`)}
                </span>
              </div>
              <p className="text-xs text-ink-muted mt-0.5">{c.proposedDescription}</p>
              <pre className="mt-1.5 text-xs text-ink-muted whitespace-pre-wrap font-mono">
                {c.proposedBody}
              </pre>
              {errorId === c.id && (
                <p className="text-xs text-semantic-danger mt-1">
                  {t("agent.learning.candidates.error")}
                </p>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => accept(c)}
                  className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded disabled:opacity-50"
                >
                  {t("agent.learning.candidates.accept")}
                </button>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => startEdit(c)}
                  className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded hover:bg-surface-border disabled:opacity-50"
                >
                  {t("agent.learning.candidates.edit")}
                </button>
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => reject(c)}
                  className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded hover:bg-surface-border disabled:opacity-50"
                >
                  {t("agent.learning.candidates.reject")}
                </button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
};
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: PASS

> If lint flags the `useEffect` dependency array, the dependency list `[agentId]` is correct (the effect only reads `agentId`); no disable comment should be needed. If `semantic-danger` is not a real color token, check a sibling component for the danger token name (the codebase uses `text-semantic-danger` — confirmed in `AgentHeader`'s status map area / banners) and adjust.

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm lint`
Expected: PASS

Run: `pnpm test`
Expected: PASS — all prior tests plus the new channel, repo, review-candidate, handler, and parity tests; no regressions. If `agents-md-handlers.test.ts` times out under parallel load, re-run `pnpm test` once — it is a known load-dependent flaky test.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/components/agent-panel/LearningPanel.tsx
git commit -m "feat(m11): add the candidates review sub-tab"
```

---

## Self-Review notes

- **Spec coverage (§10 Candidates sub-tab, §11 PR-D):** the "Candidates — fila de skill_candidates pendentes (Accept / Edit / Reject)" sub-tab → Task 6 (`CandidatesView`); the accept→real-skill conversion → Task 2 (`acceptSkillCandidate` writes `SKILL.md` + `skills` row); reject → Task 2; the IPC surface → Tasks 3-4; the pending-queue query → Task 1. **Deliberately deferred** (documented in "Decisions"): the **nudges fallback** — the compaction trigger is impossible (no M9 compaction event exists) and the remaining heuristic is token-sensitive and under-specified; nudges move to PR-F / post-M9-compaction. The `goal.achieved`/`approval.rejected` → memory triggers remain PR-E (PR-D1 decision, unchanged).
- **Placeholder scan:** every code step ships complete code; every command has an expected result. Failure paths are concrete — accept on a missing/already-reviewed candidate throws (tested); a name collision throws via the `skills` unique index and the card shows `candidates.error` (Task 6); the IPC reject path is `try/catch` in `CandidatesView`.
- **Type consistency:** `AcceptCandidateInput` / `RejectCandidateInput` are defined in `review-candidate.ts` (Task 2) and consumed by `learning-handlers.ts` (Task 3). `SkillCandidate` flows from the repo (`listPendingByAgent`, Task 1) through the handler, preload, `env.d.ts` (Tasks 3-4), into `CandidatesView` (Task 6). The handler method names (`listCandidates` / `acceptCandidate` / `rejectCandidate`) and their arg shapes are identical across `LearningHandlers`, `registerLearningHandlers`, the preload, and `env.d.ts`. `learningHandlers(db, userDataDir)` — the new 2-arg signature is used by `registerLearningHandlers` and every call site in the updated test (Task 3). `SOURCE_BY_TRIGGER` maps the `SkillCandidate.trigger` union (`issue_done`/`recovery`) to `SkillSource`.
- **Non-regression:** PR-D2 adds no agent system-prompt content (token budget unaffected). No migration, no schema change — it consumes the `skill_candidates` table and `skill_candidate_pending` inbox kind that PR-B/PR-D1 already shipped. The `learningHandlers` signature change is absorbed by updating the one production caller (`registerLearningHandlers`) and the test call sites in the same task. The i18n parity test stays green (identical keys added to both locales).
- **Out of scope (later PRs):** nudges (PR-F / post-compaction); the goal/approval → memory derivation triggers (PR-E); a live cross-sub-tab / header-badge refresh after accept (the badge refreshes on agent navigation); a reject-reason input in the UI (the IPC supports `reason`, the card does not send one).
