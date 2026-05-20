# M13 PR-E — Containment Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a declared, auditable map of privacy zones on top of the existing per-agent sandbox CWD + file-fence so a cross-company or cross-agent access attempt is denied AND recorded as a `security.zone_blocked` activity event, with a read-only Settings panel that shows the zone map.

**Architecture:** Pure classifier (`zoneOf(absPath, userDataDir): ZoneId | null`) + pure rule (`canAccess(actor, zone): boolean`) in a new `apps/main/src/security/zones.ts`. The gate (`evaluatePermission`) calls them right after the existing path-fence: an absolute path whose zone is unknown stays exactly as it was (the zone check returns null → no opinion, defer to the path-fence); a known zone the actor cannot access is denied. The recorder writes a `security.zone_blocked` activity row each deny. A read-only Settings panel surfaces the zone boundaries as transparency. Defense-in-depth — adds to, does not replace, the M6.1 sandbox CWD enforcement.

**Tech Stack:** TypeScript, Electron, better-sqlite3, MCP SDK, vitest.

**Spec:** `docs/superpowers/specs/2026-05-18-m13-outcome-verification-spine-design.md` — §9 (Containment Zones), §13 row "Settings → Segurança", §15 row E. M13 PR-A / PR-B / PR-C / PR-D all merged (HEAD `b05fcd5`, 1517 tests). PR-E is independent of pieces 1-4 per spec §9.

**Locked design decisions:**
- **`zoneOf` returns `null` for unclassified paths** (sandbox CWDs, project files, system paths the zone system has no opinion on). The gate check fires deny ONLY when `zoneOf` returns a known zone AND `canAccess` says no. The agent's own sandbox CWD, project files, anything outside `<userData>/companies/`, all fall through unchanged. Defense-in-depth: the zone check ADDS denials, never adds allows.
- **First-cut zone coverage = `company` and `agent` only.** The `ZoneId` type includes `shared` and `system` variants per spec §9, but `zoneOf` does not return them today: company-shared skills/role-library live in SQLite (not on disk in M12 PR-A), and "system" paths are not touched by agent FS tools in practice. The branches stay in `canAccess` for future-proofing; YAGNI keeps the classifier minimal.
- **Audited deny carries reason** (`"cross-company"` / `"cross-agent"`) — the implementer derives it from `actor.companyId` vs `zone.companyId` / `actor.agentId` vs `zone.agentId` (no separate user-facing message; the deny string the gate returns is plain).
- **No new MCP tool.** No agent-facing surface; PR-E is host-side only.
- **No migration.** `security.zone_blocked` action is a shared TS union + main Zod schema only (`activity_events.action` is a free string per M11 / lesson [[project-m13-pr-d-lessons]]).
- **Panel is read-only.** No edit, no per-zone toggles — the zone map is structural. Just a table showing classified roots under `<userData>`.
- **`userDataDir` threaded into the gate via `GateInput`** (not via a module-level singleton) — keeps the gate testable in pure isolation, mirrors how the gate already receives `agentCwd` / `allowedProjectPaths` per-call.
- **Out of scope for PR-E:** any UI for browsing `security.zone_blocked` activity events (the events go into the existing activity stream — the dashboard already shows it). Any inbox card for zone blocks. Live editing of zone rules. The shared zone classifier. PR-F may polish if needed.

---

## File Structure

**New files:**
- `apps/main/src/security/zones.ts` (+ `.test.ts`) — `ZoneId`, `zoneOf`, `canAccess`. Pure.
- `apps/main/src/ipc/security-handlers.ts` (+ `apps/main/tests/security-handlers.test.ts`) — IPC `securityHandlers(deps)` factory + `registerSecurityHandlers(db)`.
- `apps/renderer/src/components/SecurityZonesPanel.tsx` — read-only zone table.

**Modified files:**
- `packages/shared/src/types/activity.ts` — `ACTIVITY_ACTIONS` += `"security.zone_blocked"`.
- `apps/main/src/activity/schemas.ts` — Zod schema entry for `"security.zone_blocked"` (preserves the `satisfies Record<ActivityAction, z.ZodTypeAny>` exhaustive check).
- `packages/shared/src/ipc-channels.ts` — `SECURITY_LIST_ZONES: "security:list-zones"`.
- `apps/main/src/security/gate.ts` — `GateInput` += `userDataDir`; new zone check after the existing path-fence; deny + audit on cross-zone.
- `apps/main/src/security/gate.test.ts` — zone-deny cases.
- `apps/main/src/security/permission-watcher.ts` (and any `index.ts` wiring) — thread `userDataDir` through so the gate gets it per-call.
- `apps/main/src/ipc/handlers.ts` — register the new security handlers.
- `apps/main/src/ipc/preload.ts` + the `window.prospero` type — expose `security.listZones()`.
- `apps/renderer/src/routes/Settings.tsx` — slot in `<SecurityZonesPanel/>`.
- `apps/renderer/src/i18n/en-US.json` + `pt-BR.json` — `settings.security.*` keys.

---

## Task 1: Activity action — security.zone_blocked

**Files:**
- Modify: `packages/shared/src/types/activity.ts`
- Modify: `apps/main/src/activity/schemas.ts`
- Modify: `apps/main/src/activity/schemas.test.ts` (or wherever the schemas test lives — confirm)

> Read `packages/shared/src/types/activity.ts` to confirm the shape of `ACTIVITY_ACTIONS`. Read `apps/main/src/activity/schemas.ts` to confirm the `ActivityPayloads` object satisfies `Record<ActivityAction, z.ZodTypeAny>` (the M12 PR-D2 / M13 PR-D pattern — adding the action without the schema entry is a compile error). The `verification.failed` entry added in M13 PR-D is the immediate precedent — mirror it.

- [ ] **Step 1: Add the action to the shared union**

In `packages/shared/src/types/activity.ts`, add `"security.zone_blocked"` to the `ACTIVITY_ACTIONS` list (place it next to existing `security.*` actions if any, otherwise at the end with a `// M13 PR-E` comment for traceability).

- [ ] **Step 2: Add the Zod schema in main**

In `apps/main/src/activity/schemas.ts`, add the matching schema:

```typescript
"security.zone_blocked": z.object({
  attemptedPath: z.string(),
  zoneKind: z.enum(["company", "agent", "shared", "system"]),
  reason: z.string(),
}),
```

(Match the file's existing field-shape idiom. The plan uses three plain string/enum fields — keep payload minimal because the gate writes one event per denied call.)

- [ ] **Step 3: Run the schemas test**

Run: `pnpm --filter @prospero/main typecheck`
Expected: clean. The `satisfies Record<ActivityAction, z.ZodTypeAny>` constraint fails if the schema is missing — that's the safety net.
Run: `pnpm --filter @prospero/main test activity/schemas`
Expected: PASS (existing tests still green; nothing new required here yet — the action's behaviour is exercised by the gate test in Task 4).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/activity.ts apps/main/src/activity/schemas.ts
git commit -m "feat(security): add security.zone_blocked activity action"
```

---

## Task 2: zones module — zoneOf + canAccess

**Files:**
- Create: `apps/main/src/security/zones.ts`
- Create: `apps/main/src/security/zones.test.ts`

> Read `apps/main/src/security/gate.ts` to see how `agent` is typed (you need the `Agent` type — likely imported from `@prospero/shared`). The zone module is PURE — no I/O, no DB. The classifier inspects an absolute path relative to `userDataDir` and returns a `ZoneId` or `null`.

- [ ] **Step 1: Confirm the on-disk layout the classifier targets**

Before writing tests, grep the source for where the host writes per-company / per-agent files. Specifically look for path-construction calls that include `"companies"` and `"agents"`:

```
grep -rn "join.*'companies'" apps/main/src/
grep -rn "companyDir\|getCompanyDir\|agentDir\|getAgentDir" apps/main/src/
```

Confirm the canonical shapes are:
- `<userData>/companies/<cid>/...` — company-scoped (TELOS lives here per PR-C `companyTelosPath`).
- `<userData>/companies/<cid>/agents/<aid>/...` — agent-scoped (M12 PR-C charter/instructions, M11 memory).
- `<userData>/companies/<cid>/goals/<gid>/...` — also company-scoped (ISA lives here per PR-A).

These are the only shapes `zoneOf` classifies in the first cut. Anything else → `null`. Note the result of your grep in the implementation's header comment.

- [ ] **Step 2: Write the failing test**

Create `apps/main/src/security/zones.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { zoneOf, canAccess } from "./zones.js";
import type { Agent } from "@prospero/shared";

const ROOT = "/tmp/prospero-userdata";

const agentInCompany = (companyId: string, agentId: string): Agent =>
  ({ id: agentId, companyId } as Agent); // cast — tests only need these two fields

describe("zoneOf", () => {
  it("classifies <userData>/companies/<cid>/<file> as company zone", () => {
    expect(zoneOf(join(ROOT, "companies", "c1", "telos.md"), ROOT)).toEqual({
      kind: "company",
      companyId: "c1",
    });
  });

  it("classifies <userData>/companies/<cid>/goals/<gid>/... as company zone (goals live under the company)", () => {
    expect(zoneOf(join(ROOT, "companies", "c1", "goals", "g1", "isa.md"), ROOT)).toEqual({
      kind: "company",
      companyId: "c1",
    });
  });

  it("classifies <userData>/companies/<cid>/agents/<aid>/<file> as agent zone", () => {
    expect(
      zoneOf(join(ROOT, "companies", "c1", "agents", "a1", "charter.md"), ROOT),
    ).toEqual({ kind: "agent", companyId: "c1", agentId: "a1" });
  });

  it("classifies a deeper file inside the agent directory as agent zone", () => {
    expect(
      zoneOf(join(ROOT, "companies", "c1", "agents", "a1", "instructions", "playbook.md"), ROOT),
    ).toEqual({ kind: "agent", companyId: "c1", agentId: "a1" });
  });

  it("returns null for paths outside userDataDir", () => {
    expect(zoneOf("/some/other/place/file.txt", ROOT)).toBeNull();
  });

  it("returns null for paths inside userDataDir but outside the companies tree", () => {
    expect(zoneOf(join(ROOT, "logs", "app.log"), ROOT)).toBeNull();
  });

  it("returns null for the companies root itself (no specific company)", () => {
    expect(zoneOf(join(ROOT, "companies"), ROOT)).toBeNull();
  });
});

describe("canAccess", () => {
  it("agent can access its own agent zone", () => {
    expect(
      canAccess(agentInCompany("c1", "a1"), { kind: "agent", companyId: "c1", agentId: "a1" }),
    ).toBe(true);
  });

  it("agent cannot access another agent's zone in the same company (cross-agent)", () => {
    expect(
      canAccess(agentInCompany("c1", "a1"), { kind: "agent", companyId: "c1", agentId: "a2" }),
    ).toBe(false);
  });

  it("agent cannot access another agent's zone in a different company", () => {
    expect(
      canAccess(agentInCompany("c1", "a1"), { kind: "agent", companyId: "c2", agentId: "a1" }),
    ).toBe(false);
  });

  it("agent can access its own company zone", () => {
    expect(canAccess(agentInCompany("c1", "a1"), { kind: "company", companyId: "c1" })).toBe(true);
  });

  it("agent cannot access another company's zone (cross-company)", () => {
    expect(canAccess(agentInCompany("c1", "a1"), { kind: "company", companyId: "c2" })).toBe(false);
  });

  it("system zone is never writable for an agent", () => {
    expect(canAccess(agentInCompany("c1", "a1"), { kind: "system" })).toBe(false);
  });

  it("shared zone is accessible to any agent (read-only at the gate level)", () => {
    expect(canAccess(agentInCompany("c1", "a1"), { kind: "shared" })).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @prospero/main test zones.test`
Expected: FAIL — `Cannot find module './zones.js'`.

- [ ] **Step 4: Write the implementation**

Create `apps/main/src/security/zones.ts`:

```typescript
// Containment zones (M13 PR-E, spec §9). Declares a privacy zone for each
// known directory under <userData>; gate.ts consults zoneOf + canAccess to
// block cross-zone access and audit it via `security.zone_blocked`. Pure
// module — no I/O, no DB. Defense-in-depth on top of the M6.1 sandbox CWD.
//
// First-cut classifier coverage (confirmed by grepping the source):
//   <userData>/companies/<cid>/agents/<aid>/...    → agent zone
//   <userData>/companies/<cid>/<...else...>         → company zone
//   anything else                                   → null (no opinion)
//
// The `shared` and `system` variants are defined for spec parity but the
// classifier never returns them today — company-shared skills and the role
// library live in SQLite (M12 PR-A), and no agent FS tool path touches a
// path we'd want to flag as "system".

import { relative, sep } from "node:path";
import type { Agent } from "@prospero/shared";

export type ZoneId =
  | { kind: "company"; companyId: string }
  | { kind: "agent"; companyId: string; agentId: string }
  | { kind: "shared" }
  | { kind: "system" };

// Classifies an absolute path under <userData>. Returns null for paths the
// zone system has no opinion on — gate.ts then defers entirely to the
// existing path-fence for those.
export const zoneOf = (absPath: string, userDataDir: string): ZoneId | null => {
  const rel = relative(userDataDir, absPath);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(sep + "..")) return null;
  const parts = rel.split(sep).filter((p) => p !== "");
  // Expect: companies / <cid> / [agents / <aid> / ...]
  if (parts.length < 2 || parts[0] !== "companies") return null;
  const companyId = parts[1]!;
  if (companyId === "") return null;
  if (parts.length >= 4 && parts[2] === "agents") {
    const agentId = parts[3]!;
    if (agentId === "") return null;
    return { kind: "agent", companyId, agentId };
  }
  return { kind: "company", companyId };
};

// True iff `actor` may touch a file whose target is `zone`. Per spec §9:
//   - own `agent` zone: yes
//   - own `company` zone: yes
//   - `shared`: yes (the zone, when classified, is meant to be readable)
//   - any other agent / any other company / `system`: no
export const canAccess = (
  actor: { companyId: string; id: string } | Agent,
  zone: ZoneId,
): boolean => {
  switch (zone.kind) {
    case "agent":
      return zone.companyId === actor.companyId && zone.agentId === actor.id;
    case "company":
      return zone.companyId === actor.companyId;
    case "shared":
      return true;
    case "system":
      return false;
  }
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @prospero/main test zones.test`
Expected: PASS — 14 tests.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/security/zones.ts apps/main/src/security/zones.test.ts
git commit -m "feat(security): add containment zone classifier and access check"
```

---

## Task 3: Thread userDataDir through GateInput

**Files:**
- Modify: `apps/main/src/security/gate.ts`
- Modify: `apps/main/src/security/gate.test.ts`
- Modify: `apps/main/src/security/permission-watcher.ts`
- Modify: `apps/main/src/security/index.ts` (or wherever the watcher is constructed — confirm)
- Modify: any test that constructs a `GateInput` literal

> The gate currently receives per-call inputs (`toolName`, `toolInput`, `agent`, `allowedProjectPaths`, `agentCwd`). Add `userDataDir: string` to the same `GateInput` type and thread it from the watcher. Per the briefing the watcher is wired in `apps/main/src/security/index.ts` and currently passes a `getAgentCwd` callback — mirror that pattern (a `getUserDataDir` callback, or just a captured constant at construction time since `app.getPath("userData")` is stable).

- [ ] **Step 1: Extend `GateInput`**

In `apps/main/src/security/gate.ts`, add the field to the `GateInput` type:

```typescript
export type GateInput = {
  toolName: string;
  toolInput: unknown;
  agent: Agent;
  allowedProjectPaths: string[];
  agentCwd: string;
  userDataDir: string; // M13 PR-E: needed by the zone check (Task 4).
};
```

(`evaluatePermission` does not yet USE the field — Task 4 wires the check. Adding it now lets the watcher start threading it independently.)

- [ ] **Step 2: Thread it from the watcher**

In `apps/main/src/security/permission-watcher.ts`, find the call site that constructs a `GateInput` and calls `evaluatePermission(input)`. Add `userDataDir` to that input. The simplest pattern: when the watcher is created, capture `app.getPath("userData")` and pass it on every call. If the watcher takes a `getAgentCwd` callback, accept a sibling `userDataDir: string` (constant — userData does not change at runtime) in the same constructor / init.

In `apps/main/src/security/index.ts` (or whichever file wires the watcher), pass `app.getPath("userData")` at construction.

- [ ] **Step 3: Fix every `GateInput` literal in tests**

Run `grep -rn "evaluatePermission\|GateInput" apps/main/` and find every test fixture / mock literal that constructs a `GateInput`. Add `userDataDir: "/tmp/prospero-userdata"` (or any placeholder string) to each — the value is irrelevant until Task 4 wires the zone check.

- [ ] **Step 4: Run gate + watcher tests + typecheck**

Run: `pnpm --filter @prospero/main test gate`
Expected: PASS (all existing gate tests still green; nothing yet uses `userDataDir`).
Run: `pnpm --filter @prospero/main test permission-watcher`
Expected: PASS.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/security
git commit -m "feat(security): thread userDataDir into the gate"
```

(Adjust `git add` to the real files touched, including any test-fixture updates.)

---

## Task 4: Gate hook — zone check + audit

**Files:**
- Modify: `apps/main/src/security/gate.ts`
- Modify: `apps/main/src/security/gate.test.ts`

> Read `gate.ts`'s `evaluatePermission` carefully — find the EXACT line after the existing path-fence check decides "allow" (the line that returns `{ action: "allow" }` or similar after `isInsideAnyAllowed` passes). The new zone check fires THERE — after the path-fence already approved the path, classify the path's zone; if known AND `!canAccess`, deny + audit. If the path-fence already denied, you never reach the zone check (good — the existing denial wins, no double-audit).

- [ ] **Step 1: Add failing tests**

In `apps/main/src/security/gate.test.ts`, add (adapt to the file's existing helper that builds a `GateInput` — likely a `makeInput()` / `buildInput()` factory):

```typescript
  describe("containment zones (M13 PR-E)", () => {
    const userDataDir = "/tmp/prospero-userdata";

    it("denies a cross-company file access with reason 'cross-company'", () => {
      const input = makeInput({
        toolName: "Read",
        toolInput: { file_path: `${userDataDir}/companies/c-other/telos.md` },
        agent: { id: "a1", companyId: "c-mine" } as Agent,
        allowedProjectPaths: [`${userDataDir}/companies/c-other`], // path-fence would say allow
        userDataDir,
      });
      const decision = evaluatePermission(input);
      expect(decision.action).toBe("deny");
      expect(decision.reason).toMatch(/zone/i);
    });

    it("denies a cross-agent file access (same company)", () => {
      const input = makeInput({
        toolName: "Read",
        toolInput: { file_path: `${userDataDir}/companies/c1/agents/a-other/charter.md` },
        agent: { id: "a1", companyId: "c1" } as Agent,
        allowedProjectPaths: [`${userDataDir}/companies/c1`],
        userDataDir,
      });
      expect(evaluatePermission(input).action).toBe("deny");
    });

    it("allows the agent to touch its own agent zone", () => {
      const input = makeInput({
        toolName: "Read",
        toolInput: { file_path: `${userDataDir}/companies/c1/agents/a1/charter.md` },
        agent: { id: "a1", companyId: "c1" } as Agent,
        allowedProjectPaths: [`${userDataDir}/companies/c1`],
        userDataDir,
      });
      expect(evaluatePermission(input).action).toBe("allow");
    });

    it("allows the agent to touch its own company zone", () => {
      const input = makeInput({
        toolName: "Read",
        toolInput: { file_path: `${userDataDir}/companies/c1/telos.md` },
        agent: { id: "a1", companyId: "c1" } as Agent,
        allowedProjectPaths: [`${userDataDir}/companies/c1`],
        userDataDir,
      });
      expect(evaluatePermission(input).action).toBe("allow");
    });

    it("records a security.zone_blocked activity event on deny", () => {
      // Inject a fake recorder so we can assert on the recordActivity call.
      const recorded: Array<{ action: string; payload: unknown }> = [];
      _setRecorderForTest({
        recordActivity: (input) => recorded.push({ action: input.action, payload: input.payload }),
      } as never);
      try {
        evaluatePermission(
          makeInput({
            toolName: "Read",
            toolInput: { file_path: `${userDataDir}/companies/c-other/telos.md` },
            agent: { id: "a1", companyId: "c-mine" } as Agent,
            allowedProjectPaths: [`${userDataDir}/companies/c-other`],
            userDataDir,
          }),
        );
      } finally {
        _setRecorderForTest(null);
      }
      expect(recorded.length).toBe(1);
      expect(recorded[0]!.action).toBe("security.zone_blocked");
    });

    it("does not block paths outside the zone system (zoneOf returns null)", () => {
      const input = makeInput({
        toolName: "Read",
        toolInput: { file_path: "/some/project/file.ts" },
        agent: { id: "a1", companyId: "c1" } as Agent,
        allowedProjectPaths: ["/some/project"], // path-fence allows
        userDataDir,
      });
      expect(evaluatePermission(input).action).toBe("allow");
    });
  });
```

> Adapt the test to the gate test file's real fixture/helper style — it may use a `makeInput()` builder, an inline object, or something else. The `_setRecorderForTest` helper is the M13 PR-D Task 10 / verification engine pattern; import it from the same module the existing tests use.

Run: `pnpm --filter @prospero/main test gate`
Expected: FAIL — cross-zone access still allowed; no recorder call.

- [ ] **Step 2: Add the zone check in `evaluatePermission`**

In `apps/main/src/security/gate.ts`, locate the point AFTER the existing path-fence approves but BEFORE the function returns "allow". Add imports + the check:

```typescript
import { zoneOf, canAccess } from "./zones.js";
import { tryGetRecorder } from "../activity/index.js";

// ...inside evaluatePermission, after the path-fence check has approved:

// M13 PR-E containment zones. Defense-in-depth: the path-fence already
// accepted this path, but if it falls inside a known zone the actor cannot
// access, deny + audit. Unknown zones (zoneOf returns null) defer to the
// path-fence — no opinion.
const absPath = resolveAbsPath(input.toolInput); // however the gate already extracts it; reuse the same expression the path-fence used
if (absPath !== null) {
  const zone = zoneOf(absPath, input.userDataDir);
  if (zone !== null && !canAccess(input.agent, zone)) {
    const reason =
      zone.kind === "company" && zone.companyId !== input.agent.companyId
        ? "cross-company"
        : zone.kind === "agent" &&
          (zone.companyId !== input.agent.companyId || zone.agentId !== input.agent.id)
        ? "cross-agent"
        : zone.kind === "system"
        ? "system"
        : "denied";
    tryGetRecorder()?.recordActivity({
      companyId: input.agent.companyId,
      actor: { kind: "agent", id: input.agent.id },
      action: "security.zone_blocked",
      entityKind: "agent",
      entityId: input.agent.id,
      agentId: input.agent.id,
      payload: {
        attemptedPath: absPath,
        zoneKind: zone.kind,
        reason,
      },
    });
    return { action: "deny", reason: `zone_blocked: ${reason}` };
  }
}
```

(Adapt the snippet to the file's real shape:
- The `resolveAbsPath(input.toolInput)` line is psuedocode — the gate already extracts the absolute path for FS tools (`Read` / `Edit` / `Write` etc.) somewhere. Find that helper and reuse it. If the gate processes Bash differently, route the zone check ONLY through the FS-tool branch — Bash commands don't have a single resolvable path. The zone check applies to file-touching tools, not to Bash.
- The `tryGetRecorder()` + `recordActivity` import path mirrors M13 PR-D Task 10 (`apps/main/src/activity/index.ts`). The recorder's `RecordActivityInput` requires the same fields PR-D used; confirm.
- The recorder's `agentId` field is the agent id (M13 PR-D uses `goal.ownerAgentId` for system events; here the deny is BY the agent, so `agentId = input.agent.id` is correct).
)

- [ ] **Step 3: Run gate test + full security suite**

Run: `pnpm --filter @prospero/main test gate`
Expected: PASS — the 6 new zone tests plus all existing ones.
Run: `pnpm --filter @prospero/main test security`
Expected: PASS — every file in the security dir green.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/security/gate.ts apps/main/src/security/gate.test.ts
git commit -m "feat(security): block cross-zone access in the gate and audit it"
```

---

## Task 5: IPC handler — security:list-zones

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `apps/main/src/ipc/security-handlers.ts`
- Create: `apps/main/tests/security-handlers.test.ts`
- Modify: `apps/main/src/ipc/handlers.ts`

> Read `apps/main/src/ipc/telos-handlers.ts` (PR-C Task 10) for the `xHandlers(deps)` factory + `registerX(db)` structure — `security-handlers.ts` mirrors that shape. The handler returns a structural description of the zone map (one row per existing company × its companies/agents) suitable for the Settings panel — derived from the live DB, not hard-coded.

- [ ] **Step 1: Add the IPC channel**

In `packages/shared/src/ipc-channels.ts`, add:
```typescript
SECURITY_LIST_ZONES: "security:list-zones",
```

- [ ] **Step 2: Write the failing test**

Create `apps/main/tests/security-handlers.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../src/db/migrations.js";
import { securityHandlers } from "../src/ipc/security-handlers.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const userDataDir = mkdtempSync(join(tmpdir(), "security-zones-"));
  tmps.push(userDataDir);
  return { db, h: securityHandlers({ db, userDataDir }), userDataDir };
};

describe("securityHandlers.listZones", () => {
  it("returns an empty list when there are no companies", () => {
    const { h } = setup();
    expect(h.listZones()).toEqual([]);
  });

  it("returns one company zone per company plus one agent zone per agent", () => {
    const { db, h } = setup();
    const repo = createCompaniesRepository(db);
    const c1 = repo.create({ name: "Acme" });
    // Seed an agent. Adapt the INSERT to the real `agents` schema — copy from a
    // sibling test (e.g. apps/main/src/mcp/tools-isa.test.ts seeds an agent).
    db.prepare(
      "INSERT INTO agents (id, company_id, name, role, status, model, system_prompt, mode, always_on, schedule, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run("a1", c1.id, "Eng", "engineer", "idle", "claude-sonnet-4-6", "", "headless", 0, null, 0, 0);
    const zones = h.listZones();
    // One company zone for c1, one agent zone for a1.
    expect(zones.length).toBe(2);
    expect(zones.some((z) => z.kind === "company" && z.companyId === c1.id && z.companyName === "Acme")).toBe(true);
    expect(zones.some((z) => z.kind === "agent" && z.agentId === "a1" && z.companyId === c1.id)).toBe(true);
  });
});
```

> Match the seeding pattern of an existing security/handlers test. If the `agents` INSERT does not match the real schema (extra NOT NULL columns since), copy the working INSERT from `apps/main/src/mcp/tools-isa.test.ts` (the PR-B2 test seeds an agent row to satisfy a FK).

Run: `pnpm --filter @prospero/main test security-handlers`
Expected: FAIL — `Cannot find module '../src/ipc/security-handlers.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/main/src/ipc/security-handlers.ts`:

```typescript
import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";

// Read-only view of the containment zone map for the Settings panel
// (M13 PR-E, spec §13 row "Settings → Segurança"). Derives one entry per
// live company plus one per live agent — the actual zone authority is
// apps/main/src/security/zones.ts; this is purely a transparency surface.

export type ZoneSummary =
  | { kind: "company"; companyId: string; companyName: string; samplePath: string }
  | {
      kind: "agent";
      companyId: string;
      companyName: string;
      agentId: string;
      agentName: string;
      samplePath: string;
    };

export type SecurityHandlersDeps = {
  db: Database.Database;
  userDataDir: string;
};

export type SecurityHandlers = {
  listZones(): ZoneSummary[];
};

export const securityHandlers = (deps: SecurityHandlersDeps): SecurityHandlers => {
  return {
    listZones() {
      const out: ZoneSummary[] = [];
      const companies = deps.db
        .prepare("SELECT id, name FROM companies ORDER BY created_at ASC")
        .all() as Array<{ id: string; name: string }>;
      for (const c of companies) {
        out.push({
          kind: "company",
          companyId: c.id,
          companyName: c.name,
          samplePath: `${deps.userDataDir}/companies/${c.id}`,
        });
        const agents = deps.db
          .prepare(
            "SELECT id, name FROM agents WHERE company_id = ? ORDER BY created_at ASC",
          )
          .all(c.id) as Array<{ id: string; name: string }>;
        for (const a of agents) {
          out.push({
            kind: "agent",
            companyId: c.id,
            companyName: c.name,
            agentId: a.id,
            agentName: a.name,
            samplePath: `${deps.userDataDir}/companies/${c.id}/agents/${a.id}`,
          });
        }
      }
      return out;
    },
  };
};

export const registerSecurityHandlers = (db: Database.Database): void => {
  const h = securityHandlers({ db, userDataDir: app.getPath("userData") });
  ipcMain.handle(IPC.SECURITY_LIST_ZONES, () => h.listZones());
};
```

(Confirm the `agents` table has a `name` column. If not, swap to the right column — `role`, `identifier`, whichever is the human-readable label.)

- [ ] **Step 4: Register the handlers**

In `apps/main/src/ipc/handlers.ts`, add the import and the registration call next to other `register*Handlers(db)` calls:
```typescript
import { registerSecurityHandlers } from "./security-handlers.js";
```
```typescript
  registerSecurityHandlers(db);
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @prospero/main test security-handlers`
Expected: PASS — 2 tests.
Run: `pnpm --filter @prospero/main typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/security-handlers.ts apps/main/tests/security-handlers.test.ts apps/main/src/ipc/handlers.ts
git commit -m "feat(security): add security:list-zones ipc handler"
```

---

## Task 6: Preload bridge + window typing

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: the `window.prospero` type declaration (likely `apps/renderer/src/env.d.ts`)

> Read `apps/main/src/ipc/preload.ts` to find the existing `telos` namespace (PR-C Task 12) — copy its style for a new `security` namespace. Find the matching `window.prospero` type declaration (the `telos` namespace lives there too).

- [ ] **Step 1: Add the `security` namespace to the preload bridge**

In `apps/main/src/ipc/preload.ts`, inside `exposeInMainWorld("prospero", { ... })`, next to `telos`:

```typescript
security: {
  listZones: () => ipcRenderer.invoke(IPC.SECURITY_LIST_ZONES) as Promise<ZoneSummary[]>,
},
```

Add `ZoneSummary` to the imports from `../ipc/security-handlers.js` (or wherever the file imports IPC types).

- [ ] **Step 2: Mirror the namespace in the `window.prospero` type**

In the `window.prospero` type-declaration file, add the same field:
```typescript
security: {
  listZones: () => Promise<ZoneSummary[]>;
};
```
Add `ZoneSummary` to that file's import list.

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm --filter @prospero/main typecheck`
Run: `pnpm --filter @prospero/renderer typecheck`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/main/src/ipc/preload.ts apps/renderer/src
git commit -m "feat(security): expose security.listZones on the preload bridge"
```

---

## Task 7: SecurityZonesPanel component

**Files:**
- Create: `apps/renderer/src/components/SecurityZonesPanel.tsx`

> Read `apps/renderer/src/routes/Settings.tsx` for the existing panel pattern — how a read-only "info" section is styled (the file likely already has panels for adapter / auth-mode / model / etc.). Mirror that style. Read `apps/renderer/src/components/ui/index.ts` for the `Section` / `LoadingState` primitives. Use only real Tailwind tokens — confirm against `apps/renderer/tailwind.config.ts`. No test file (UI task; same convention as PR-C Tasks 14/15).

- [ ] **Step 1: Write the component**

Create `apps/renderer/src/components/SecurityZonesPanel.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { ZoneSummary } from "../../../main/src/ipc/security-handlers.js";

// Read-only transparency panel for the M13 PR-E containment zones (spec §9,
// §13). Lists one row per company zone + one per agent zone, with the
// sample path. The zone authority is apps/main/src/security/zones.ts — this
// surface is purely informational.

export const SecurityZonesPanel: FC = () => {
  const { t } = useTranslation();
  const [zones, setZones] = useState<ZoneSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.prospero.security.listZones();
        setZones(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  if (error !== null) {
    return <p className="text-xs text-semantic-danger">{error}</p>;
  }
  if (zones === null) {
    return <p className="text-xs text-ink-muted">{t("settings.security.loading")}</p>;
  }
  if (zones.length === 0) {
    return <p className="text-xs text-ink-muted">{t("settings.security.empty")}</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead className="text-ink-muted">
        <tr className="text-left">
          <th className="py-1 pr-3 font-semibold">{t("settings.security.kind")}</th>
          <th className="py-1 pr-3 font-semibold">{t("settings.security.company")}</th>
          <th className="py-1 pr-3 font-semibold">{t("settings.security.agent")}</th>
          <th className="py-1 font-semibold">{t("settings.security.path")}</th>
        </tr>
      </thead>
      <tbody className="text-ink">
        {zones.map((z, i) => (
          <tr key={i} className="border-t border-surface-border">
            <td className="py-1 pr-3 font-mono">{z.kind}</td>
            <td className="py-1 pr-3">{z.companyName}</td>
            <td className="py-1 pr-3">{z.kind === "agent" ? z.agentName : "—"}</td>
            <td className="py-1 font-mono text-ink-soft">{z.samplePath}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
```

> The import path `../../../main/src/ipc/security-handlers.js` for the `ZoneSummary` type is the project's standard cross-package import (renderer imports type-only from main — confirm by grepping how the renderer imports other main-package types). If a different convention applies (e.g. types re-exported from `@prospero/shared`), use that instead. The point: a `ZoneSummary` literal must match the IPC handler's return shape.

If the renderer cannot cleanly import from `apps/main/src/...`, define a renderer-local mirror type at the top of the component file or in `apps/renderer/src/types/security.ts`. That is acceptable and the M13 PR-C Task 12 / preload pattern uses inline types in `env.d.ts`.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/renderer lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/SecurityZonesPanel.tsx
git commit -m "feat(security): add the security zones settings panel"
```

---

## Task 8: Slot the panel into Settings + i18n keys

**Files:**
- Modify: `apps/renderer/src/routes/Settings.tsx`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

> Read `Settings.tsx` to find a sensible insertion point — likely after the adapter / auth-mode section, before "Budgets" (or wherever the page already has system-level read-only info). The i18n key set must be IDENTICAL between EN and PT (the parity test enforces it — same pattern as PR-C Task 17).

- [ ] **Step 1: Add the section in Settings**

In `apps/renderer/src/routes/Settings.tsx`, add the import:
```typescript
import { SecurityZonesPanel } from "../components/SecurityZonesPanel.js";
```
And a new section block, matching the existing section style (read a sibling section to copy the exact heading/wrapper classes):

```tsx
<section>
  <h2 className="text-sm font-bold text-ink">{t("settings.security.title")}</h2>
  <p className="text-xs text-ink-muted">{t("settings.security.subtitle")}</p>
  <SecurityZonesPanel />
</section>
```

(Match the file's existing section wrapper — if it uses `<Section>` from `components/ui`, use that. If it uses bare `<div>`, match.)

- [ ] **Step 2: Add the English keys**

In `apps/renderer/src/i18n/en-US.json`, add (merge into existing `settings` object):

```json
"security": {
  "title": "Security zones",
  "subtitle": "Each agent is structurally limited to its own zone and its company's zone. Cross-zone access is denied and audited.",
  "loading": "Loading zones…",
  "empty": "No zones to show yet — create a company first.",
  "kind": "Kind",
  "company": "Company",
  "agent": "Agent",
  "path": "Sample path"
}
```

- [ ] **Step 3: Add the Portuguese keys**

In `apps/renderer/src/i18n/pt-BR.json`, add (mirror set, identical keys):

```json
"security": {
  "title": "Zonas de segurança",
  "subtitle": "Cada agente é estruturalmente limitado à própria zona e à zona da empresa dele. Acesso cross-zone é negado e auditado.",
  "loading": "Carregando zonas…",
  "empty": "Nenhuma zona pra mostrar ainda — crie uma empresa primeiro.",
  "kind": "Tipo",
  "company": "Empresa",
  "agent": "Agente",
  "path": "Caminho de exemplo"
}
```

- [ ] **Step 4: Run the parity test**

Run: `pnpm --filter @prospero/renderer test parity`
Expected: PASS — EN/PT key sets identical.

- [ ] **Step 5: Run typecheck + lint**

Run: `pnpm --filter @prospero/renderer typecheck`
Run: `pnpm --filter @prospero/renderer lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/routes/Settings.tsx apps/renderer/src/i18n
git commit -m "feat(security): slot the zones panel into settings"
```

---

## Task 9: Full verification + non-regression

**Files:** none (verification only).

- [ ] **Step 1: Update any count assertion**

PR-E adds 0 MCP tools, 1 IPC channel (`SECURITY_LIST_ZONES`), 0 migrations. PR-C Task 18 confirmed there is no IPC channel count assertion; confirm again. Skip this step if nothing fails.

- [ ] **Step 2: Typecheck the whole monorepo**

Run: `pnpm typecheck`
Expected: clean across all 4 packages.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: every package green. Confirm the new PR-E suites pass: `zones.test`, `security-handlers.test`, plus the updated `gate.test`, `activity/schemas` (typecheck-enforced), `permission-watcher.test` (if any literals were updated).

- [ ] **Step 5: Token efficiency — sanity check**

PR-E adds NOTHING to any agent system prompt — the change is entirely host-side (gate hook, IPC, Settings panel). Confirm by grepping `apps/main/src/orchestrator/` for any `zones` import — there should be none. Document the result.

- [ ] **Step 6: Security non-regression (the §16 promise)**

Add a tiny shell snippet to the report: run `pnpm --filter @prospero/main test security` and quote the per-file pass count. The security suite is the load-bearing test for this PR; every file in `apps/main/src/security/` should be green.

- [ ] **Step 7: Manual smoke (PENDING — list, do NOT attempt in this environment)**

The Electron app cannot be run by a subagent. In the report, list these PENDING steps for the human:
1. Launch the app. Open Settings. Confirm a "Security zones" section is visible, with one row per existing company + one per agent, paths under `<userData>/companies/...`.
2. Have an agent in company A try to read `<userData>/companies/<companyB-id>/telos.md` via the Read tool. Confirm the gate denies with a `zone_blocked` reason AND a `security.zone_blocked` activity event appears in the activity stream.
3. Have an agent try to read another agent's `charter.md` (same company). Confirm cross-agent deny + audit.
4. Have the agent read its own company's `telos.md` and its own `charter.md`. Confirm BOTH allow.

- [ ] **Step 8: Final commit (only if Step 1 required edits)**

```bash
git add -A
git commit -m "test(security): update count assertions"
```

---

## Self-Review (completed by plan author)

**Spec coverage (§9 + §13 row "Settings → Segurança" + §15 row E):**
- §9 `containment-zones.ts` with `zoneOf` + `canAccess` → Task 2. ✓
- §9 check in the existing gate; cross-zone → blocked AND audited via `activity_event` `security.zone_blocked` → Tasks 1 + 4. ✓
- §9 rules: own `agent`, own `company`, `shared` accessible; other companies / other agents / `system` denied → encoded in `canAccess` (Task 2). ✓
- §9 defense-in-depth (does not replace sandbox CWD) → architectural locked decision; `zoneOf` returns `null` for non-zone paths so the existing path-fence is unchanged. ✓
- §13 read-only Settings panel → Tasks 5-8 (IPC + preload + component + slot + i18n). ✓
- §15 row E: zone module + check + audit + Settings panel — all four pieces present. ✓

**Schema impact: ZERO.** No migration; `activity_events.action` is a free string (M11 / [[project-m13-pr-d-lessons]]). Only TS-level changes: `ACTIVITY_ACTIONS` union + Zod schema (Task 1), `GateInput.userDataDir` (Task 3), `ZoneId` type (Task 2), `ZoneSummary` type (Task 5).

**Placeholder scan:** every code-changing step shows the code. Two intentional adapt points are flagged explicitly so the implementer adapts to the real surroundings: Task 3 step 2 (the watcher's exact wiring depends on how it currently receives `getAgentCwd`); Task 4 step 2 (the gate's exact "extract absPath" expression is the gate's existing helper — reuse, don't reinvent). Both are flagged as "find this; mirror it", not "TBD".

**Type consistency:** `ZoneId` defined Task 2, consumed Task 4 (gate) and Task 5 (IPC handler shape). `ZoneSummary` defined Task 5, consumed Tasks 6 (preload) and 7 (panel). `GateInput` extended Task 3, consumed Task 4. `security.zone_blocked` action defined Task 1, written Task 4.

**Token efficiency:** zero impact on any agent system prompt (Task 9 step 5 verifies). The gate hook is per-tool-call and adds 2 SQL-free pure-function calls + one optional recorder call on deny.

**Security boundaries:** the design is purely additive — zone check can only DENY a call the path-fence would have allowed; it can never allow a call the path-fence denied. The audit event includes only the attempted path (already known to the gate), the zone kind (a 4-value enum), and a short reason string. No leak of cross-company data into the audit payload.
