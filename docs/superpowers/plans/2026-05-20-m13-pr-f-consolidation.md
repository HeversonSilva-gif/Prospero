# M13 PR-F — Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the M13 milestone by knocking down the eight accumulated follow-ups from PR-A through PR-E (TELOS validation, ISA/TELOS in company export, criterion_judge UI broadcast, zone-blocked inbox card, verification UI polish, SECURITY.md, roadmap.html refresh, non-regression audit).

**Architecture:** Eight independent commits in `main`. No new tables, no new MCP tools, no new IPC channels. Each commit is small (most ≤100 LOC); two are doc-only; one is non-regression checklist. Order is chosen so each commit lands typecheck + tests green.

**Tech Stack:** TypeScript, Electron, better-sqlite3, Zod, React + Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-05-20-m13-pr-f-consolidation-design.md`. M13 PR-A..PR-E all merged (HEAD `eee2d41` after spec commit, 1550 tests).

**Locked design decisions:**
- **Bundled PR in `main`** — same pattern as PR-E (8 commits in sequence, no feature branch). The user picked Approach A.
- **No new migrations.** `inbox_items.kind` is a free string (M11+ precedent), so the new `security_zone_blocked` kind needs no schema change.
- **`artifacts` field for export, not nested per-row.** Adding `companyTelos: string?` and `goalIsas: Record<goalId, string>?` at top level of `CompanyExportV1` keeps the row arrays untouched (they stay `unknown[]`) and the import schema delta minimal.
- **`validateTelos` is advisory, not blocking.** The synthesized TELOS still saves on user click; the UI shows errors inline so the user can fix-and-resave, or accept as-is.
- **Inbox card has no CTA.** Deny is irreversible — the agent already got blocked. Card is informative only (path + reason). De-dup of 5 minutes prevents loops from spamming.
- **UI polish capped at 200 LOC.** It's polish, not redesign. `frontend-design` skill is consulted but the implementer commits with restraint.
- **Out of scope:** smoke manual run of the M13 app, smoke of `claude -p` headless (M11 pendency), hardening of `criterion_judge` (e.g., forcing the judge to be a different agent — documented as open in SECURITY.md), translation of SECURITY.md.

---

## File Structure

**New files:** none.

**Modified files:**

| Task | File | Purpose |
|------|------|---------|
| 1 | `apps/main/src/companies/telos-synthesis.ts` | call `validateTelos`, propagate errors |
| 1 | `apps/main/src/companies/telos-synthesis.test.ts` | new failing test |
| 1 | `packages/shared/src/types/telos.ts` | extend `TelosDraft` with optional `error?: string[]` |
| 1 | `apps/renderer/src/routes/Telos.tsx` | render errors inline above editor |
| 2 | `apps/main/src/companies/export.ts` | add `artifacts.companyTelos` + `artifacts.goalIsas` |
| 2 | `apps/main/src/companies/import.ts` | restore artifacts in new userData |
| 2 | `apps/main/src/companies/import-schema.ts` | add `artifacts` optional |
| 2 | `apps/main/src/companies/export.test.ts` + `import.test.ts` | round-trip cases |
| 3 | `apps/main/src/mcp/tools-isa.ts` (`criterion_judge` handler) | call notify after `applyVerificationReport` |
| 3 | `apps/main/src/mcp/tools-isa.test.ts` | assert broadcast |
| 4 | `apps/main/src/security/gate.ts` | inbox row alongside the activity record |
| 4 | `apps/main/tests/security.gate-zones.test.ts` | assert inbox creation + de-dup |
| 4 | `apps/renderer/src/routes/Inbox.tsx` (or InboxItem switch) | render new kind |
| 4 | `apps/renderer/src/i18n/{en-US,pt-BR}.json` | strings |
| 5 | `apps/renderer/src/components/IsaPanel.tsx` | polish (states + contrast + rhythm) |
| 6 | `SECURITY.md` | two new sections |
| 7 | `docs/roadmap.html` | refresh /00 and /03 |
| 8 | none (audit checklist) | — |

---

## Task 1: Validate synthesized TELOS

**Files:**
- Modify: `packages/shared/src/types/telos.ts`
- Modify: `apps/main/src/companies/telos-synthesis.ts`
- Modify: `apps/main/src/companies/telos-synthesis.test.ts`
- Modify: `apps/renderer/src/routes/Telos.tsx`

> Read `packages/shared/src/types/telos.ts` to see the current `TelosDraft` shape. Read `packages/shared/src/telos.ts` to see `validateTelos` (already exported). Read `apps/main/src/companies/telos-synthesis.ts` to find the spot where the synthesized markdown is returned.

- [ ] **Step 1: Extend `TelosDraft`**

In `packages/shared/src/types/telos.ts`, add an optional `error?: string[]` field to `TelosDraft`. Keep all other fields exactly as they are.

- [ ] **Step 2: Write the failing test**

In `apps/main/src/companies/telos-synthesis.test.ts`, add a test that constructs a `runDerivation` stub returning a body missing the `## Mission` section, then asserts:

```typescript
it("propagates validateTelos errors on the draft", async () => {
  const draft = await synthesizeTelos(
    { db, runDerivation: () => Promise.resolve({ text: "# TELOS\n\nno sections", usage: zeroUsage }) },
    { answers: validAnswers, env: {}, companyId },
  );
  expect(draft.error).toBeDefined();
  expect(draft.error!.length).toBeGreaterThan(0);
  expect(draft.body).toContain("no sections"); // body still returned for editing
});
```

Adapt `validAnswers` and `zeroUsage` to the file's existing fixtures.

Run: `pnpm --filter @prospero/main test telos-synthesis`
Expected: FAIL — `draft.error` undefined.

- [ ] **Step 3: Wire `validateTelos` into the synthesis**

In `apps/main/src/companies/telos-synthesis.ts`, after the `sanitizeMemoryBody` step (and any other normalization already in place), call `validateTelos(body)`. If it returns a non-empty array of errors, attach them to the returned draft:

```typescript
import { validateTelos } from "@prospero/shared";
// ...
const errors = validateTelos(body);
return {
  body,
  ...(errors.length > 0 ? { error: errors } : {}),
  // ...other existing fields
};
```

Match the exact spread shape the file already uses for optional fields. Do **not** throw — the body still saves; the error is advisory.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @prospero/main test telos-synthesis`
Expected: PASS — existing tests still green, new case green.

- [ ] **Step 5: Render the errors in the renderer**

In `apps/renderer/src/routes/Telos.tsx`, find the spot that consumes the synthesis result (likely a state variable like `draft` or `synthResult`). Above the editor textarea, conditionally render the errors:

```tsx
{draft?.error && draft.error.length > 0 && (
  <div className="mb-3 rounded border border-semantic-danger bg-surface-soft p-2 text-xs text-semantic-danger">
    <p className="font-semibold mb-1">{t("telos.validationErrors")}</p>
    <ul className="list-disc pl-4">
      {draft.error.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
  </div>
)}
```

Add the i18n keys:
- `en-US.json`: `"telos": { "validationErrors": "Validation issues — you can still save:" ... }`
- `pt-BR.json`: `"telos": { "validationErrors": "Problemas de validação — você ainda pode salvar:" ... }`

(Merge into the existing `telos` namespace; do not duplicate the whole namespace.)

- [ ] **Step 6: Run typecheck + parity**

Run: `pnpm --filter @prospero/main typecheck`
Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/renderer test parity`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/telos.ts apps/main/src/companies/telos-synthesis.ts apps/main/src/companies/telos-synthesis.test.ts apps/renderer/src/routes/Telos.tsx apps/renderer/src/i18n
git commit -m "feat(telos): validate synthesized telos before saving"
```

---

## Task 2: Include ISA + TELOS in company export

**Files:**
- Modify: `apps/main/src/companies/export.ts`
- Modify: `apps/main/src/companies/import.ts`
- Modify: `apps/main/src/companies/import-schema.ts`
- Modify: `apps/main/src/companies/export.test.ts`
- Modify: `apps/main/src/companies/import.test.ts`

> Read `apps/main/src/companies/export.ts` (`CompanyExportV1`) and `import.ts` (two-pass). Read `apps/main/src/companies/telos-store.ts` and `apps/main/src/goals/isa-store.ts` to find the read/write helpers for the two artifact files.

- [ ] **Step 1: Extend the export type**

In `apps/main/src/companies/export.ts`, add to `CompanyExportV1`:

```typescript
artifacts?: {
  companyTelos?: string;
  goalIsas?: Record<string, string>;
};
```

Keep `schemaVersion: 1` — the field is opt-in.

- [ ] **Step 2: Write the failing export test**

In `apps/main/src/companies/export.test.ts`, add:

```typescript
it("includes telos and isa bodies when files exist on disk", () => {
  const { db, userDataDir, companyId, goalId } = setupCompanyWithGoal();
  writeTelos(userDataDir, companyId, "# TELOS\n\n## Mission\n\nx");
  writeIsa(userDataDir, companyId, goalId, "# ISA\n\n## Vision\n\ny");
  const out = exportCompany(db, companyId, userDataDir);
  expect(out.artifacts?.companyTelos).toContain("Mission");
  expect(out.artifacts?.goalIsas?.[goalId]).toContain("Vision");
});
```

Adapt `setupCompanyWithGoal`, `writeTelos`, `writeIsa` to the file's existing helpers. The current `exportCompany(db, companyId)` signature does NOT take a `userDataDir`; this step expands it. Update the existing call sites once below.

Run: `pnpm --filter @prospero/main test "companies/export"`
Expected: FAIL — `artifacts` undefined.

- [ ] **Step 3: Implement the read in export.ts**

Change `exportCompany(db, companyId)` to `exportCompany(db, companyId, userDataDir)`. Inside, after building the rows:

```typescript
import { readTelos } from "./telos-store.js";
import { readIsa } from "../goals/isa-store.js";
// ...
const companyTelos = readTelos(userDataDir, companyId);
const goalRows = result.goals as Array<{ id: string }>;
const goalIsas: Record<string, string> = {};
for (const g of goalRows) {
  const body = readIsa(userDataDir, companyId, g.id);
  if (body !== null) goalIsas[g.id] = body;
}
const artifacts =
  companyTelos !== null || Object.keys(goalIsas).length > 0
    ? {
        ...(companyTelos !== null ? { companyTelos } : {}),
        ...(Object.keys(goalIsas).length > 0 ? { goalIsas } : {}),
      }
    : undefined;
return { ...result, ...(artifacts !== undefined ? { artifacts } : {}) };
```

(Confirm the exact names of `readTelos` and `readIsa`; the renderer-facing handlers PR-C / PR-A use a consistent path layout — re-use those readers rather than reinventing.)

Find every call site of `exportCompany` (likely only in `apps/main/src/ipc/companies-handlers.ts`) and pass `app.getPath("userData")`.

- [ ] **Step 4: Run the export test**

Run: `pnpm --filter @prospero/main test "companies/export"`
Expected: PASS.

- [ ] **Step 5: Extend the import schema**

In `apps/main/src/companies/import-schema.ts`, add to `CompanyImportSchemaV1`:

```typescript
artifacts: z
  .object({
    companyTelos: z.string().optional(),
    goalIsas: z.record(z.string()).optional(),
  })
  .optional(),
```

- [ ] **Step 6: Write the failing import test**

In `apps/main/src/companies/import.test.ts`, add a round-trip:

```typescript
it("restores telos and isa bodies into the new company's userData", () => {
  const { db, srcUserData, companyId, goalId } = setupCompanyWithGoal();
  writeTelos(srcUserData, companyId, "# TELOS\n\n## Mission\n\nx");
  writeIsa(srcUserData, companyId, goalId, "# ISA\n\n## Vision\n\ny");
  const payload = exportCompany(db, companyId, srcUserData);

  const destUserData = mkdtempSync(join(tmpdir(), "import-"));
  const destDb = new Database(":memory:");
  applyMigrations(destDb);
  const result = importCompany(destDb, payload, destUserData);

  expect(readTelos(destUserData, result.newCompanyId)).toContain("Mission");
  const newGoalId = result.goalIdMap[goalId]!;
  expect(readIsa(destUserData, result.newCompanyId, newGoalId)).toContain("Vision");
});
```

Adapt names to the file's real helpers. The `goalIdMap` field is part of `importCompany`'s existing return shape per [[project-m9-pr-f2-1-lessons]] — confirm by reading the source.

Run: `pnpm --filter @prospero/main test "companies/import"`
Expected: FAIL — `readTelos`/`readIsa` returns null at the destination.

- [ ] **Step 7: Implement the restore in import.ts**

Change `importCompany(db, payload)` to `importCompany(db, payload, userDataDir)`. After the two-pass row insert (and after `idMap` is finalized), restore the artifacts:

```typescript
import { writeTelos } from "./telos-store.js";
import { writeIsa } from "../goals/isa-store.js";
import { createCompaniesRepository } from "./repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { relativeTelosPath } from "./telos-dir.js";
import { relativeIsaPath } from "../goals/isa-dir.js";
// ...
if (payload.artifacts?.companyTelos) {
  writeTelos(userDataDir, newCompanyId, payload.artifacts.companyTelos);
  createCompaniesRepository(db).setTelosPath(newCompanyId, relativeTelosPath(newCompanyId));
}
if (payload.artifacts?.goalIsas) {
  const goalsRepo = createGoalsRepository(db);
  for (const [origGoalId, body] of Object.entries(payload.artifacts.goalIsas)) {
    const newGoalId = goalIdMap[origGoalId];
    if (newGoalId === undefined) continue;
    writeIsa(userDataDir, newCompanyId, newGoalId, body);
    goalsRepo.setIsaPath?.(newGoalId, relativeIsaPath(newCompanyId, newGoalId));
  }
}
```

(Confirm `setTelosPath` / `setIsaPath` names and `relativeXPath` helpers; both PR-A and PR-C used the same idiom — re-use, don't reinvent. If `setIsaPath` does not exist as a method, write a one-line UPDATE.)

Update the call site in `companies-handlers.ts` to pass `app.getPath("userData")`.

- [ ] **Step 8: Run import test + full companies suite**

Run: `pnpm --filter @prospero/main test "companies/import"`
Expected: PASS.
Run: `pnpm --filter @prospero/main test companies`
Expected: PASS — every file in the companies dir green.

- [ ] **Step 9: Run typecheck**

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add apps/main/src/companies apps/main/src/ipc/companies-handlers.ts
git commit -m "feat(company): include isa.md and telos.md in company export"
```

---

## Task 3: Broadcast goal update when criterion_judge completes

**Files:**
- Modify: `apps/main/src/mcp/tools-isa.ts`
- Modify: `apps/main/src/mcp/tools-isa.test.ts`

> Read `apps/main/src/mcp/tools-isa.ts` for the `criterion_judge` handler. Read `apps/main/src/verification/index.ts` `applyVerificationReport` — `RunVerificationDeps.notify` is already an optional callback signature `(companyId: string) => void`. The B1 broadcast pattern lives in `apps/main/src/ipc/issue-events-broadcast.ts` (`broadcastGoalChanged` or similar — confirm with grep).

- [ ] **Step 1: Confirm broadcast helper exists**

Run: `grep -rn "broadcastGoal\|broadcastIssue" apps/main/src/ipc/`
Find the function the B1 verifier uses to push a goal-changed event to the renderer. Likely `broadcastGoalChanged(companyId)` in `issue-events-broadcast.ts` (or sibling file). Note the import path.

- [ ] **Step 2: Write the failing test**

In `apps/main/src/mcp/tools-isa.test.ts`, find the test that exercises `criterion_judge` closing a goal (the path where all criteria pass and `applyVerificationReport` transitions to `achieved`). Extend or add a sibling test that asserts the broadcast was called:

```typescript
it("broadcasts a goal change after criterion_judge closes the goal", async () => {
  const calls: string[] = [];
  const broadcast = vi.fn((companyId: string) => calls.push(companyId));
  // override the broadcast hook the tool uses. The exact mechanism depends
  // on how the tool wires `notify` today — if it pulls from a module-level
  // import, use vi.mock; if it accepts a callback via ctx, inject directly.
  // ...
  await callCriterionJudge(ctx, { criterionId, verdict: "passed" });
  expect(calls.length).toBeGreaterThan(0);
});
```

Wire the broadcast via the same mechanism the B1 already uses — the test must reflect that mechanism, not invent a new one.

Run: `pnpm --filter @prospero/main test tools-isa`
Expected: FAIL.

- [ ] **Step 3: Wire `notify` into the judge handler**

In `apps/main/src/mcp/tools-isa.ts`'s `criterion_judge` handler, where it calls `applyVerificationReport(...)`, pass the broadcast helper as the `notify` callback:

```typescript
import { broadcastGoalChanged } from "../ipc/issue-events-broadcast.js"; // confirm name + path
// ...
applyVerificationReport(db, report, { fileReviewCard: false });
// add: notify the renderer that this goal changed (PR-F follow-up of PR-B2)
try {
  broadcastGoalChanged(goal.companyId);
} catch (err) {
  console.warn("[criterion_judge] broadcastGoalChanged failed", err);
}
```

(If `applyVerificationReport` already accepts a `notify` callback via its options, prefer threading through it. Read the function signature first.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @prospero/main test tools-isa`
Expected: PASS.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/mcp/tools-isa.ts apps/main/src/mcp/tools-isa.test.ts
git commit -m "feat(verification): broadcast goal update when criterion_judge completes"
```

---

## Task 4: Inbox card for security.zone_blocked

**Files:**
- Modify: `apps/main/src/security/gate.ts`
- Modify: `apps/main/tests/security.gate-zones.test.ts`
- Modify: `apps/renderer/src/routes/Inbox.tsx` (or wherever the kind switch lives — confirm)
- Modify: `apps/renderer/src/i18n/en-US.json` + `pt-BR.json`

> Read `apps/main/src/security/gate.ts` `auditZoneBlocked` — the function already records the activity event. Add inbox creation right after. Read `apps/main/src/inbox/repository.ts` to find the `create(input)` signature; mirror how other handlers create inbox items (e.g., `apps/main/src/verification/index.ts`).

- [ ] **Step 1: Write the failing tests**

In `apps/main/tests/security.gate-zones.test.ts`, extend the existing setup to inject a fake inbox repository (or use a real one against an in-memory `Database(":memory:")`). Add:

```typescript
it("creates an inbox card on the first cross-zone deny", () => {
  const { db } = freshDb();
  _setRecorderForTest({ recordActivity: vi.fn() });
  // gate setup with userDataDir; same fixture as the existing tests
  evaluatePermission({ /* cross-company case */ });
  const cards = db
    .prepare("SELECT kind, payload_json FROM inbox_items WHERE kind = ?")
    .all("security_zone_blocked");
  expect(cards).toHaveLength(1);
  const payload = JSON.parse((cards[0] as { payload_json: string }).payload_json);
  expect(payload).toMatchObject({ zoneKind: "company", reason: "cross-company" });
});

it("de-dups repeated denials within 5 minutes", () => {
  const { db } = freshDb();
  _setRecorderForTest({ recordActivity: vi.fn() });
  evaluatePermission({ /* cross-company case */ });
  evaluatePermission({ /* same agent, same target, again */ });
  evaluatePermission({ /* same again */ });
  const cards = db
    .prepare("SELECT id FROM inbox_items WHERE kind = 'security_zone_blocked'")
    .all();
  expect(cards).toHaveLength(1);
});
```

The `freshDb` helper sets up an in-memory db with migrations applied. This is the same pattern as `security-handlers.test.ts` — copy that setup. The `evaluatePermission` call needs a real `db` reachable from the gate; today the gate has no db handle. **Decision point:** thread an `inboxRepo` (or a lightweight `inbox: { createZoneBlocked: ... }` callback) through `GateInput`, OR resolve it via a module-level setter analogous to `_setRecorderForTest`.

Recommendation: **add an `_setInboxForTest` + `tryGetInbox` pair in a new `apps/main/src/inbox/index.ts` (mirroring `activity/index.ts`)**, and use `tryGetInbox()?.create({...})` from the gate. This avoids polluting `GateInput` with a heavyweight repository. The wiring is the same as the recorder.

Run: `pnpm --filter @prospero/main test gate-zones`
Expected: FAIL.

- [ ] **Step 2: Add the inbox accessor module**

Create or extend `apps/main/src/inbox/index.ts` with:

```typescript
import type { InboxRepository } from "./repository.js";

let _inbox: InboxRepository | null = null;

export const initInbox = (repo: InboxRepository): void => {
  _inbox = repo;
};
export const tryGetInbox = (): InboxRepository | undefined => _inbox ?? undefined;
export const _setInboxForTest = (repo: InboxRepository | null): void => {
  _inbox = repo;
};
```

Wire `initInbox` in `apps/main/src/ipc/handlers.ts` right after `initRecorder`:

```typescript
const inboxRepo = createInboxRepository(db); // confirm this is the right factory
initInbox(inboxRepo);
```

(If an inbox repo is already constructed somewhere in `handlers.ts` or `index.ts`, reuse it.)

- [ ] **Step 3: Update `auditZoneBlocked` to create the inbox card with de-dup**

In `apps/main/src/security/gate.ts`, extend `auditZoneBlocked`:

```typescript
import { tryGetInbox } from "../inbox/index.js";
// ...
const auditZoneBlocked = (agent: Agent, absPath: string, zone: ZoneId, reason: string): void => {
  try {
    tryGetRecorder()?.recordActivity({ /* existing */ });
  } catch (err) {
    console.warn("[gate] failed to record security.zone_blocked", err);
  }
  try {
    const inbox = tryGetInbox();
    if (inbox === undefined) return;
    const recent = inbox.findRecentUnread?.({
      companyId: agent.companyId,
      agentId: agent.id,
      kind: "security_zone_blocked",
      withinMs: 5 * 60 * 1000,
    });
    if (recent !== undefined && recent !== null) return; // de-dup
    inbox.create({
      companyId: agent.companyId,
      kind: "security_zone_blocked",
      actorId: agent.id,
      title: `Zone block: ${reason}`,
      preview: absPath.slice(-120),
      requiresAction: false,
      payloadJson: JSON.stringify({ attemptedPath: absPath, zoneKind: zone.kind, reason }),
    });
  } catch (err) {
    console.warn("[gate] failed to create zone_blocked inbox card", err);
  }
};
```

If `findRecentUnread` does not exist on `InboxRepository`, add it:

```typescript
findRecentUnread(args: { companyId: string; agentId: string; kind: string; withinMs: number }): InboxItem | null;
```

Implement in `apps/main/src/inbox/repository.ts` with a SQL `SELECT ... WHERE company_id=? AND actor_id=? AND kind=? AND read_at IS NULL AND created_at > ?`.

- [ ] **Step 4: Run the gate tests**

Run: `pnpm --filter @prospero/main test gate-zones`
Expected: PASS — original 6 cases still green, 2 new cases green.

- [ ] **Step 5: Render the new kind in the Inbox UI**

In the renderer, find where inbox items render per kind (likely `apps/renderer/src/routes/Inbox.tsx` or a `InboxItemRow` component — grep `kind === "approval"` or the kinds switch). Add a render branch for `security_zone_blocked`:

```tsx
{item.kind === "security_zone_blocked" && (
  <div>
    <p className="text-xs text-semantic-warning font-semibold">
      {t("inbox.zoneBlocked.title")}
    </p>
    <p className="text-xs text-ink-muted">{item.preview}</p>
  </div>
)}
```

Add i18n keys `inbox.zoneBlocked.title` to both locale files (identical key sets).

- [ ] **Step 6: Run renderer typecheck + parity**

Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/renderer test parity`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/inbox apps/main/src/security/gate.ts apps/main/src/ipc/handlers.ts apps/main/tests/security.gate-zones.test.ts apps/renderer/src apps/renderer/src/i18n
git commit -m "feat(security): add zone_blocked inbox card"
```

---

## Task 5: Polish the goal verification panel

**Files:**
- Modify: `apps/renderer/src/components/IsaPanel.tsx`

> No test file — visual polish. Cap: **200 LOC net new**. Goal: improve the ISA criteria list UI from "functional" to "production-grade". This is the only task in PR-F that benefits from the `frontend-design` skill — invoke it for the design decisions, then apply restraint when committing.

- [ ] **Step 1: Capture the current state**

Run: `wc -l apps/renderer/src/components/IsaPanel.tsx`
Note the current size. Read the full file to understand the criteria-list section (`STATUS_DOT` map + however the list renders today).

- [ ] **Step 2: Invoke `frontend-design`**

> Use the **frontend-design skill** (`Skill` tool) with the following brief:
>
> *"Polish the ISA criteria list inside `IsaPanel.tsx`. Constraints: Tailwind tokens only (real tokens from `apps/renderer/tailwind.config.ts`); no emojis (project rule); cap +200 LOC. The list shows criteria with one of 4 statuses (pending / passed / failed / waived). Today's UI is one row per criterion with a status dot + label + description; that's it. Improve: explicit loading / empty / error states, stronger contrast between statuses (passed muted-ok, failed loud, pending neutral, waived strikethrough), better vertical rhythm, group failed criteria visually at the top (to draw attention). Do NOT redesign the textarea, the auto-save UX, or any non-criteria section."*

Apply the design proposal. Keep changes inside `IsaPanel.tsx`. Reject any proposal that would touch other files.

- [ ] **Step 3: Verify the cap**

Run: `wc -l apps/renderer/src/components/IsaPanel.tsx`
The delta should be ≤ 200 lines. If it exceeds, trim before committing.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/renderer lint`
Expected: both clean.

- [ ] **Step 5: Run the renderer tests (no new tests; ensure none broke)**

Run: `pnpm --filter @prospero/renderer test`
Expected: PASS — 168 tests still green.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/components/IsaPanel.tsx
git commit -m "feat(verification): polish goal verification panel"
```

---

## Task 6: SECURITY.md — zones + verification as attack vectors

**Files:**
- Modify: `SECURITY.md`

> Read the current `SECURITY.md` (root of repo). It already has sections from M7.5 PR-C; pick a sensible insertion point (probably right after the existing per-adapter threat model section). No tests.

- [ ] **Step 1: Add the containment-zones section**

Append (or insert at the appropriate spot) a section like:

```markdown
## Containment zones (M13 PR-E)

A declared map of privacy zones layered on top of the per-agent sandbox CWD.
Every absolute path that an FS tool tries to touch is classified by
`apps/main/src/security/zones.ts`:

- `companies/<cid>/...` and the `agent-instructions/<cid>/...` / `memory/<cid>/...` prefixes → **company** zone.
- `companies/<cid>/agents/<aid>/...` (and the equivalent under the other prefixes) → **agent** zone.
- Anything outside this tree → no opinion (the existing path-fence decides).

The gate denies any access that falls into a known zone the actor cannot
reach:

- An agent can touch its own agent zone and the company zone it belongs to.
- Cross-company, cross-agent, and system zones are denied.

Every deny is audited as a `security.zone_blocked` activity event and (since
M13 PR-F) creates a non-actionable inbox card with the attempted path and
reason. **This is defense-in-depth**: the path-fence is still the primary
filter — the zone check can only add denials, never lift them.
```

- [ ] **Step 2: Add the verification-as-vector section**

Append:

```markdown
## Verification as an attack surface (M13 PR-B)

The verification engine treats an issue as "done" when its criteria pass.
That makes the criterion-check path itself a target: a misbehaving agent
might mark criteria as `passed` without actually doing the work.

Current mitigations:

- `criterion_judge` records the `verified_by` agent id (audit row); a
  judgment from agent A is always attributable to agent A.
- Deterministic criteria (command, artifact, metric) cannot be self-judged
  via `criterion_judge`; they only flip when the engine runs the check.

Known gap (tracked for V2):

- `criterion_check` is self-reported by the agent doing the work. There is
  no enforcement that the judge of a judgment criterion is a different agent
  than the implementer. A bad-actor agent that knows the gate exists can
  still mark its own judgment criteria passed.

The right hardening is forcing `criterion_judge` to require an actor distinct
from the issue's assignee. Spec'd, not implemented in v1.
```

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs(security): document zones and verification as attack vectors"
```

---

## Task 7: Refresh roadmap.html for M11-M13

**Files:**
- Modify: `docs/roadmap.html`

> Read `docs/roadmap.html` to understand the structure. Read `ROADMAP.md` side by side (sections "Em linguagem simples" + "Status atual" + "▸ Agora") for the source-of-truth narrative. The page is for laypeople — no jargon.

- [ ] **Step 1: Survey the current state**

Run: `grep -n '<section' docs/roadmap.html | head -20`
Identify the sections labeled `/00` (overview), `/03` (status), and any others that touch milestones. Note the current "what works today" lists.

- [ ] **Step 2: Update the /00 overview**

The current narrative likely stops at M10 / v1-shipped. Add M11 (memory & learning) + M12 (org definition / charters / budget) + M13 (verification spine: ISA, verification engine, TELOS, Algorithm, containment zones) in the layperson tone of `ROADMAP.md`'s "Em linguagem simples" section. **Mirror the phrasing already used in `ROADMAP.md`** so the two documents tell the same story.

- [ ] **Step 3: Update the /03 status block**

The status block usually has counters (milestones / tests / commits). Bring numbers in line with the current state (14/14 v1 + M11 ✅ + M12 ✅ + M13 5/6 PRs at the start of this task, will be 6/6 by the end). Tests = 1550+ depending on where we are in the PR-F sequence.

- [ ] **Step 4: Visual smoke (manual)**

Open `docs/roadmap.html` in a browser. Check:
- All animations still play.
- Layout is still responsive (resize the window).
- No console errors.
- All sections render.

Note any issues in the commit message if you find them; do not block the commit on visual perfection.

- [ ] **Step 5: Commit**

```bash
git add docs/roadmap.html
git commit -m "docs(roadmap): refresh public roadmap.html for m11-m13"
```

---

## Task 8: M13 non-regression audit

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo typecheck**

Run: `pnpm typecheck`
Expected: clean across all 4 packages.

- [ ] **Step 2: Whole-repo lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Whole-repo test**

Run: `pnpm test`
Expected: every package green. Total should be ≥ 1555 (1550 going in + ~5 new from Tasks 1-4). Note the actual final number in the commit message body.

- [ ] **Step 4: Security suite focus**

Run: `pnpm --filter @prospero/main test security`
Expected: every file in `apps/main/src/security/` green. The PR-E baseline was 75 tests in 7 files; PR-F adds ~2 to `gate-zones` (78 total expected).

- [ ] **Step 5: IPC channel sanity**

Run: `pnpm --filter @prospero/shared test ipc-channels`
Expected: PASS. PR-F adds no channels, so this is unchanged.

- [ ] **Step 6: Token efficiency sanity**

Run: `grep -rn "security_zone_blocked\|artifacts.companyTelos\|artifacts.goalIsas" apps/main/src/orchestrator/`
Expected: zero results. PR-F changes are entirely host-side — no agent system prompt growth.

- [ ] **Step 7: Inventory of new tests**

Note in the commit message which files gained tests:
- `telos-synthesis.test.ts`: +1
- `companies/export.test.ts`: +1
- `companies/import.test.ts`: +1
- `mcp/tools-isa.test.ts`: +1
- `security.gate-zones.test.ts`: +2 (creation + de-dup)

Total: ~+6, expected 1556 final.

- [ ] **Step 8: Commit the audit notes (only if Step 1 or 2 surfaced fixes; otherwise skip)**

If no fixes were needed, skip the commit — the audit is a checkpoint, not a code change. **Note in the PR-F summary that the audit was clean.** Otherwise:

```bash
git add -A
git commit -m "test: m13 non-regression audit"
```

---

## Self-Review (completed by plan author)

**Spec coverage (8 items from §2 of the spec):**

- 1. `validateTelos` in synthesis → Task 1 ✓
- 2. `company:export` + `:import` carry ISA + TELOS → Task 2 ✓
- 3. Broadcast on `criterion_judge` → Task 3 ✓
- 4. Inbox card for `security.zone_blocked` → Task 4 ✓
- 5. Verification UI polish → Task 5 ✓
- 6. SECURITY.md sections → Task 6 ✓
- 7. roadmap.html refresh → Task 7 ✓
- 8. Non-regression audit → Task 8 ✓

**Placeholder scan:** every code-changing step shows the code. Five flagged adapt-points: Task 2 (exact names of `readTelos`/`readIsa` and `setTelosPath`/`setIsaPath`), Task 3 (exact broadcast function name and wiring mechanism), Task 4 step 1 (decision between threading inbox via `GateInput` vs. module-level setter — recommendation locked, but implementer confirms), Task 5 (the `frontend-design` brief is concrete enough but the exact applied design depends on the skill's proposal), Task 7 (`/00` and `/03` selectors depend on current `roadmap.html` structure). All five are flagged as "find this; mirror it" / "decide based on existing pattern" — none are "TBD".

**Type consistency:** `TelosDraft` extended in Task 1 (consumed in Task 1 step 5). `CompanyExportV1.artifacts` defined in Task 2 step 1 (consumed Task 2 step 7). `InboxRepository.findRecentUnread` defined in Task 4 step 3 (consumed in same step). Module accessor `tryGetInbox` defined in Task 4 step 2 (consumed Task 4 step 3).

**Token efficiency:** zero impact on any agent system prompt (Task 8 step 6 verifies).

**Security boundaries:** the new inbox card path (Task 4) cannot be abused — it is created by the gate's own deny path, on user-side state, with de-dup. The export path (Task 2) is single-user, file-system local, no privilege escalation.
