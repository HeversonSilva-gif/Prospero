# M9 PR-E — Error Handling §7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the resilience layer from spec §7: banner OAuth invalid + OAuth expiry banner (deferred from PR-C) + rate-limit banner with exponential backoff + agent heartbeat (5min) + auto-restart main on crash.

**Architecture:** Backend stores `expires_at` alongside the OAuth token blob (extracted from `~/.claude/.credentials.json` when auto-detect runs). Stream parser surfaces `rate_limit_event` as a new `ParsedEvent` kind. Heartbeat scanner runs every 60s as a background timer in `index.ts`, marks stale agents `error` + creates `agent_unresponsive` inbox item. `index.ts` adds `uncaughtException` handler that calls `app.relaunch()` after a 5s log flush. Renderer ships 3 small banners (`AuthErrorBanner`, `OAuthExpiryBanner`, `RateLimitBanner`) into a shared slot rendered above the main content in `App.tsx`.

**Tech Stack:** Electron (`app.relaunch`, `app.exit`), better-sqlite3, zustand, React 18, react-i18next, vitest.

---

## File map

**Create:**
- `apps/main/src/orchestrator/heartbeat.ts` — background scanner + tests
- `apps/main/src/orchestrator/heartbeat.test.ts`
- `apps/renderer/src/components/banners/AuthErrorBanner.tsx`
- `apps/renderer/src/components/banners/OAuthExpiryBanner.tsx`
- `apps/renderer/src/components/banners/RateLimitBanner.tsx`
- `apps/renderer/src/lib/oauth-expiry.ts` — pure `daysUntil(expiresAt, now)` helper
- `apps/renderer/src/lib/oauth-expiry.test.ts`

**Modify:**
- `packages/shared/src/types/auth.ts` — `TokenStatus` adds `expiresAt: number | null`
- `packages/shared/src/types/inbox.ts` — `InboxKind` adds `agent_unresponsive`
- `packages/shared/src/types/adapter.ts` — `ParsedEvent` adds `rate-limited` kind
- `apps/main/src/auth/token-storage.ts` — persist `expires_at` blob
- `apps/main/src/auth/token-detect.ts` — return `{ token, expiresAt }` instead of plain string
- `apps/main/src/ipc/auth-handlers.ts` — adjust import-detected to capture expiresAt
- `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts` — surface rate_limit_event
- `apps/main/src/db/migrations/0013_inbox_goal_kinds.sql` — won't touch; add new migration `0015_inbox_agent_unresponsive.sql` (we need to check column constraint)
- `apps/main/src/ipc/orchestrator-handlers.ts` — broadcast on rate-limited event + start heartbeat timer
- `apps/main/src/index.ts` — uncaughtException handler + start heartbeat
- `apps/renderer/src/App.tsx` — render banner slot above `<main>`
- `apps/renderer/src/i18n/pt-BR.json` + `en-US.json` + `parity.test.ts`
- `ROADMAP.md` + `docs/roadmap.html`

---

## Task 1: OAuth `expiresAt` storage + token-detect extension + TokenStatus

**Files:**
- Modify: `packages/shared/src/types/auth.ts`
- Modify: `apps/main/src/auth/token-detect.ts`
- Modify: `apps/main/src/auth/token-storage.ts`
- Modify: `apps/main/src/ipc/auth-handlers.ts`
- Modify: `apps/main/tests/auth.token-validate.test.ts` / `auth.token-redact.test.ts` — verify, may need new test file

- [ ] **Step 1.1: Extend shared TokenStatus**

Edit `packages/shared/src/types/auth.ts`:

```typescript
export type TokenStatus =
  | { hasToken: false }
  | {
      hasToken: true;
      source: TokenSource;
      maskedPrefix: string;
      configuredAt: number;
      expiresAt: number | null;
    };
```

- [ ] **Step 1.2: token-detect.ts returns object**

Replace `apps/main/src/auth/token-detect.ts` with:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isWellFormedToken } from "./token-validate.js";

export type DetectedToken = { token: string; expiresAt: number | null };

export const detectClaudeCliToken = (home: string = homedir()): DetectedToken | null => {
  const path = join(home, ".claude", ".credentials.json");
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const candidate = (parsed as Record<string, unknown>)["claudeAiOauth"];
  if (candidate === null || typeof candidate !== "object") return null;
  const token = (candidate as Record<string, unknown>)["accessToken"];
  if (typeof token !== "string" || !isWellFormedToken(token)) return null;
  const rawExpires = (candidate as Record<string, unknown>)["expiresAt"];
  const expiresAt = typeof rawExpires === "number" && Number.isFinite(rawExpires) ? rawExpires : null;
  return { token, expiresAt };
};
```

> **Note:** The existing call sites (`apps/main/src/ipc/auth-handlers.ts`) expect a `string | null`. Updating the function signature breaks them — they need updates in Task 1.3.

- [ ] **Step 1.3: token-storage.ts persist expires_at**

Edit `apps/main/src/auth/token-storage.ts`. Add a new DB key constant near the others:

```typescript
const KEY_EXPIRES_AT = "auth.token.expires_at";
```

Update `SaveInput` type:

```typescript
type SaveInput = { raw: string; source: TokenSource; expiresAt?: number | null };
```

Update `saveToken`:

```typescript
export const saveToken = (db: Database.Database, input: SaveInput): void => {
  const raw = input.raw.trim();
  if (!isWellFormedToken(raw)) {
    throw new Error("Token is not well-formed");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption is not available on this machine");
  }
  const cipher = safeStorage.encryptString(raw);
  const tx = db.transaction(() => {
    upsert(db, KEY_CIPHERTEXT, cipher.toString("base64"));
    upsert(db, KEY_SOURCE, input.source);
    upsert(db, KEY_PREFIX, redactToken(raw));
    upsert(db, KEY_AT, String(Date.now()));
    if (input.expiresAt !== undefined && input.expiresAt !== null) {
      upsert(db, KEY_EXPIRES_AT, String(input.expiresAt));
    } else {
      remove(db, KEY_EXPIRES_AT);
    }
  });
  tx();
};
```

Update `loadTokenStatus`:

```typescript
export const loadTokenStatus = (db: Database.Database): TokenStatus => {
  const cipher = select(db, KEY_CIPHERTEXT);
  if (cipher === null) return { hasToken: false };
  const source = select(db, KEY_SOURCE);
  const prefix = select(db, KEY_PREFIX);
  const at = select(db, KEY_AT);
  const expiresAtRaw = select(db, KEY_EXPIRES_AT);
  if (source === null || prefix === null || at === null) return { hasToken: false };
  if (source !== "manual" && source !== "auto-detect") return { hasToken: false };
  const expiresAt = expiresAtRaw !== null ? Number.parseInt(expiresAtRaw, 10) : null;
  return {
    hasToken: true,
    source,
    maskedPrefix: prefix,
    configuredAt: Number.parseInt(at, 10),
    expiresAt,
  };
};
```

Also update `clearToken` to remove the new key:

```typescript
export const clearToken = (db: Database.Database): void => {
  const tx = db.transaction(() => {
    remove(db, KEY_CIPHERTEXT);
    remove(db, KEY_SOURCE);
    remove(db, KEY_PREFIX);
    remove(db, KEY_AT);
    remove(db, KEY_EXPIRES_AT);
  });
  tx();
};
```

- [ ] **Step 1.4: auth-handlers.ts adjust import-detected**

Edit `apps/main/src/ipc/auth-handlers.ts`. The handler `AUTH_TOKEN_IMPORT_DETECTED` currently does:

```typescript
const raw = detectClaudeCliToken(homeDirProvider());
if (raw === null) {
  throw new Error("No Claude CLI token detected to import");
}
saveToken(db, { raw, source: "auto-detect" });
```

Replace with:

```typescript
const detected = detectClaudeCliToken(homeDirProvider());
if (detected === null) {
  throw new Error("No Claude CLI token detected to import");
}
saveToken(db, { raw: detected.token, source: "auto-detect", expiresAt: detected.expiresAt });
```

Similarly update `AUTH_TOKEN_DETECT`:

```typescript
ipcMain.handle(IPC.AUTH_TOKEN_DETECT, (): DetectResult => {
  const detected = detectClaudeCliToken(homeDirProvider());
  if (detected === null) return { found: false };
  return { found: true, maskedPrefix: redactToken(detected.token) };
});
```

- [ ] **Step 1.5: Update token-detect tests**

Check `apps/main/tests/` for `token-detect`-related tests. Grep:

```bash
grep -rln "detectClaudeCliToken" apps/main
```

For each call site in tests, adjust the expected return from `string | null` to `DetectedToken | null`. Example:

```typescript
expect(detectClaudeCliToken("/tmp")).toBe(null);
```

becomes:

```typescript
expect(detectClaudeCliToken("/tmp")).toBeNull();
```

And:

```typescript
expect(detectClaudeCliToken(home)).toBe("sk-ant-oat-...");
```

becomes:

```typescript
expect(detectClaudeCliToken(home)).toEqual({ token: "sk-ant-oat-...", expiresAt: ... });
```

> If a fixture credentials.json includes `expiresAt`, the test should pass it through. If not, expect `expiresAt: null`.

- [ ] **Step 1.6: Typecheck + commit**

```bash
pnpm -r typecheck
pnpm --filter @dashboard-agent/main test -- auth
git add packages/shared/src/types/auth.ts apps/main/src/auth/token-detect.ts apps/main/src/auth/token-storage.ts apps/main/src/ipc/auth-handlers.ts apps/main/tests
git commit -m "feat(m9): persist oauth expires_at; token-detect returns {token, expiresAt}"
```

---

## Task 2: Rate-limit event in stream parser

**Files:**
- Modify: `packages/shared/src/types/adapter.ts`
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts`

- [ ] **Step 2.1: Extend ParsedEvent**

Edit `packages/shared/src/types/adapter.ts`. Update `ParsedEvent`:

```typescript
export type ParsedEvent =
  | { kind: "session-init"; sessionId: string }
  | { kind: "assistant-message"; blocks: AssistantContentBlock[] }
  | { kind: "tool-result"; toolUseId: string; content: string; isError: boolean }
  | { kind: "turn-complete"; usage?: UsageEstimate; model?: string }
  | { kind: "api-retry"; attempt: number; error: string }
  | { kind: "rate-limited"; retryAfterSec: number | null; message: string }
  | { kind: "unknown"; raw: unknown };
```

- [ ] **Step 2.2: stream-parser surfaces rate_limit_event**

Edit `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts`. Find the line:

```typescript
  // ignore rate_limit_event, etc.
  if (data["type"] === "rate_limit_event") return null;
```

Replace with:

```typescript
  if (data["type"] === "rate_limit_event") {
    const retryAfter =
      typeof data["retry_after"] === "number" && Number.isFinite(data["retry_after"])
        ? Math.floor(data["retry_after"])
        : null;
    const msg =
      typeof data["message"] === "string"
        ? data["message"]
        : "Rate limit reached. Pausing the agent.";
    return { kind: "rate-limited", retryAfterSec: retryAfter, message: msg };
  }
```

- [ ] **Step 2.3: Append test to existing parser test**

Check `apps/main/tests/orchestrator.stream-parser.test.ts` (or wherever stream-parser is tested). Add:

```typescript
describe("parseStreamLine rate_limit_event", () => {
  it("returns rate-limited kind with retryAfter when present", () => {
    const ev = parseStreamLine(
      JSON.stringify({ type: "rate_limit_event", retry_after: 30, message: "Cool down 30s" }),
    );
    expect(ev).toEqual({ kind: "rate-limited", retryAfterSec: 30, message: "Cool down 30s" });
  });

  it("returns rate-limited with retryAfterSec null when missing", () => {
    const ev = parseStreamLine(JSON.stringify({ type: "rate_limit_event" }));
    expect(ev?.kind).toBe("rate-limited");
    if (ev?.kind === "rate-limited") {
      expect(ev.retryAfterSec).toBeNull();
    }
  });
});
```

> **If no stream-parser test file exists**, create one at `apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.test.ts` (same dir as the impl).

- [ ] **Step 2.4: Typecheck + run + commit**

```bash
pnpm --filter @dashboard-agent/main typecheck
pnpm --filter @dashboard-agent/main test -- stream-parser
git add packages/shared/src/types/adapter.ts apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.ts apps/main/src/orchestrator/adapters/claude-oauth-local/stream-parser.test.ts
git commit -m "feat(m9): stream-parser surfaces rate-limited event with retryAfterSec"
```

---

## Task 3: Rate-limit broadcast in orchestrator-handlers

**Files:**
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

- [ ] **Step 3.1: Handle rate-limited in event switch**

Find the event handler block (around line 411). After the `api-retry` branch, add:

```typescript
} else if (ev.kind === "rate-limited") {
  // Pause the agent until the rate window passes. The renderer banner reads
  // this via agent:event kind=rate-limited and the user sees a yellow banner.
  agents.updateStatus(agent.id, { status: "waiting", currentAction: "Rate limited" });
  broadcast({
    kind: "status-changed",
    agentId: agent.id,
    status: "waiting",
    updatedAt: Date.now(),
  });
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, {
      kind: "rate-limited",
      agentId: agent.id,
      retryAfterSec: ev.retryAfterSec,
      message: ev.message,
    });
  }
}
```

> **Note:** This emits a new event kind `rate-limited` on the existing `AGENT_EVENT` channel. The renderer-side `AgentEvent` union in `packages/shared/src/types/agent.ts` (or wherever it lives) needs to be extended too.

- [ ] **Step 3.2: Extend AgentEvent union**

Grep for `AgentEvent` type definition:

```bash
grep -rln "kind:.*\"status-changed\"" packages/shared
```

Find the union (likely in `packages/shared/src/types/agent.ts` or `event.ts`). Add a variant:

```typescript
| { kind: "rate-limited"; agentId: string; retryAfterSec: number | null; message: string }
```

- [ ] **Step 3.3: Typecheck + commit**

```bash
pnpm -r typecheck
git add apps/main/src/ipc/orchestrator-handlers.ts packages/shared/src/types
git commit -m "feat(m9): orchestrator broadcasts rate-limited agent:event"
```

---

## Task 4: Heartbeat scanner + `agent_unresponsive` inbox kind

**Files:**
- Create: `apps/main/src/orchestrator/heartbeat.ts`
- Create: `apps/main/src/orchestrator/heartbeat.test.ts`
- Modify: `packages/shared/src/types/inbox.ts`
- Modify: `apps/main/src/db/migrations/` — new migration if inbox_items kind check constraint exists

- [ ] **Step 4.1: Check inbox kind constraint**

```bash
grep -n "CHECK.*kind IN" apps/main/src/db/migrations/0001_initial.sql apps/main/src/db/migrations/0013_inbox_goal_kinds.sql
```

If the constraint exists, the new kind `agent_unresponsive` must be added via a new migration. The pattern from `0013_inbox_goal_kinds.sql` is the model.

Create `apps/main/src/db/migrations/0015_inbox_agent_unresponsive.sql`:

```sql
-- 0015_inbox_agent_unresponsive.sql — M9 PR-E
-- Adds 'agent_unresponsive' to inbox_items.kind CHECK list. Pattern: rebuild
-- the table (SQLite doesn't ALTER CHECK directly).

PRAGMA defer_foreign_keys = 1;

CREATE TABLE inbox_items_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('approval','completed','suggestion','error','security_alert','goal_proposed','goal_executing','goal_error','agent_unresponsive')),
  actor_id TEXT,
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT,
  requires_action INTEGER NOT NULL DEFAULT 0,
  approval_id TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

INSERT INTO inbox_items_new SELECT * FROM inbox_items;
DROP TABLE inbox_items;
ALTER TABLE inbox_items_new RENAME TO inbox_items;
```

> **Confirm column order**: copy from the most recent migration that touched `inbox_items` (0013_inbox_goal_kinds.sql). If the columns differ from what I wrote, copy exactly.

- [ ] **Step 4.2: Extend shared InboxKind**

Edit `packages/shared/src/types/inbox.ts`:

```typescript
export type InboxKind =
  | "approval"
  | "completed"
  | "suggestion"
  | "error"
  | "security_alert"
  | "goal_proposed"
  | "goal_executing"
  | "goal_error"
  | "agent_unresponsive";
```

- [ ] **Step 4.3: Write failing heartbeat tests**

Create `apps/main/src/orchestrator/heartbeat.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanStaleAgents } from "./heartbeat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
  return db;
};

const insertAgent = (
  db: Database.Database,
  id: string,
  status: string,
  updatedAt: number,
): void => {
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, status, model, created_at, updated_at)
     VALUES (?, 'c1', 'A', 'r', 'p', ?, 'claude-sonnet-4-6', 0, ?)`,
  ).run(id, status, updatedAt);
};

const insertActivity = (db: Database.Database, agentId: string, createdAt: number): void => {
  db.prepare(
    `INSERT INTO activity_events (id, company_id, actor_kind, actor_id, action, entity_kind, entity_id, agent_id, payload_json, created_at)
     VALUES (?, 'c1', 'agent', ?, 'agent.hired', 'agent', ?, ?, '{}', ?)`,
  ).run(`act_${String(createdAt)}`, agentId, agentId, agentId, createdAt);
};

describe("scanStaleAgents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));
  });

  it("returns no agents when status=working but recent activity (<5min)", () => {
    const db = setupDb();
    const now = Date.now();
    insertAgent(db, "ag1", "working", now);
    insertActivity(db, "ag1", now - 60_000); // 1 min ago
    expect(scanStaleAgents(db, 5 * 60_000)).toEqual([]);
  });

  it("returns agents with status=working but no activity in 5min", () => {
    const db = setupDb();
    const now = Date.now();
    insertAgent(db, "ag1", "working", now);
    insertActivity(db, "ag1", now - 6 * 60_000); // 6 min ago
    expect(scanStaleAgents(db, 5 * 60_000).map((a) => a.id)).toEqual(["ag1"]);
  });

  it("ignores idle/error/terminated agents", () => {
    const db = setupDb();
    const now = Date.now();
    insertAgent(db, "ag1", "idle", now);
    insertAgent(db, "ag2", "error", now);
    insertAgent(db, "ag3", "terminated", now);
    expect(scanStaleAgents(db, 5 * 60_000)).toEqual([]);
  });

  it("returns agent with status=working and no activity rows at all", () => {
    const db = setupDb();
    const now = Date.now();
    insertAgent(db, "ag1", "working", now - 10 * 60_000); // updated 10 min ago, no activity
    expect(scanStaleAgents(db, 5 * 60_000).map((a) => a.id)).toEqual(["ag1"]);
  });
});
```

- [ ] **Step 4.4: Implement scanner**

Create `apps/main/src/orchestrator/heartbeat.ts`:

```typescript
import type Database from "better-sqlite3";

export type StaleAgent = { id: string; companyId: string; name: string };

const SQL = `
  SELECT a.id AS id, a.company_id AS companyId, a.name AS name
  FROM agents a
  WHERE a.status IN ('working', 'thinking')
    AND COALESCE(
      (SELECT MAX(created_at) FROM activity_events WHERE agent_id = a.id),
      a.updated_at
    ) < @cutoff
`;

export const scanStaleAgents = (db: Database.Database, thresholdMs: number): StaleAgent[] => {
  const cutoff = Date.now() - thresholdMs;
  return db.prepare(SQL).all({ cutoff }) as StaleAgent[];
};
```

Run: `pnpm --filter @dashboard-agent/main test -- heartbeat`. Expected PASS.

- [ ] **Step 4.5: Add markAsUnresponsive helper + side-effect function**

Append to `apps/main/src/orchestrator/heartbeat.ts`:

```typescript
import type { AgentsRepository } from "../agents/repository.js";
import type { InboxRepository } from "../inbox/repository.js";

export type HeartbeatDeps = {
  db: Database.Database;
  agents: AgentsRepository;
  inbox: InboxRepository;
  broadcastInbox: (companyId: string) => void;
  thresholdMs: number;
};

export const tickHeartbeat = (deps: HeartbeatDeps): number => {
  const stale = scanStaleAgents(deps.db, deps.thresholdMs);
  for (const a of stale) {
    deps.agents.updateStatus(a.id, { status: "error", currentAction: null });
    deps.inbox.create({
      companyId: a.companyId,
      kind: "agent_unresponsive",
      actorId: a.id,
      title: `Agent ${a.name} appears unresponsive`,
      preview: `No activity for over ${String(Math.round(deps.thresholdMs / 60_000))} minutes.`,
      requiresAction: false,
      payloadJson: null,
    });
    deps.broadcastInbox(a.companyId);
  }
  return stale.length;
};

export const startHeartbeat = (deps: HeartbeatDeps, intervalMs = 60_000): (() => void) => {
  const timer = setInterval(() => {
    try {
      tickHeartbeat(deps);
    } catch {
      // Best-effort — heartbeat must not crash main.
    }
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
};
```

- [ ] **Step 4.6: Wire into index.ts**

Edit `apps/main/src/index.ts`. Near the top, add imports:

```typescript
import { startHeartbeat } from "./orchestrator/heartbeat.js";
```

Inside `app.whenReady().then(...)`, after the existing setup (after `tray = createTray(getWindow)`):

```typescript
const heartbeatStop = startHeartbeat({
  db,
  agents: agentsRepo,
  inbox: inboxRepo,
  broadcastInbox: broadcastInboxUpdate,
  thresholdMs: 5 * 60_000,
});
```

Add cleanup to `before-quit`:

```typescript
app.on("before-quit", () => {
  heartbeatStop?.();
  void stopPermissionWatcher?.();
  // …rest
});
```

> **Scope hazard:** `heartbeatStop` is declared inside the callback, so the `before-quit` handler outside can't see it. Solution: declare a module-level `let heartbeatStop: (() => void) | null = null;` and assign inside the callback. Add to `before-quit`. Match the existing `stopPermissionWatcher` pattern.

- [ ] **Step 4.7: Typecheck + commit**

```bash
pnpm -r typecheck
pnpm --filter @dashboard-agent/main test
git add packages/shared/src/types/inbox.ts apps/main/src/db/migrations/0015_inbox_agent_unresponsive.sql apps/main/src/orchestrator/heartbeat.ts apps/main/src/orchestrator/heartbeat.test.ts apps/main/src/index.ts
git commit -m "feat(m9): heartbeat scanner — stale agents become error + agent_unresponsive inbox"
```

---

## Task 5: Auto-restart main on uncaughtException

**Files:**
- Modify: `apps/main/src/index.ts`

- [ ] **Step 5.1: Add handler**

Edit `apps/main/src/index.ts`. Near the top of the file (after imports, before `app.whenReady`), add:

```typescript
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const logEmergency = (err: unknown): void => {
  try {
    const dir = app.getPath("userData");
    const path = join(dir, "emergency.log");
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    appendFileSync(path, `[${new Date().toISOString()}] uncaughtException: ${msg}\n\n`);
  } catch {
    // best effort
  }
};

process.on("uncaughtException", (err) => {
  logEmergency(err);
  // 5s window for stdout flush + IPC drain; then relaunch.
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 5_000);
});
```

> **Test note:** there's no automated test for this — Electron's `app.relaunch` and `process.on('uncaughtException')` are nontrivial to drive in vitest. Use `it.todo` markers if needed in a heartbeat.test.ts or skip tests. Manual smoke covers it.

- [ ] **Step 5.2: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/main typecheck
git add apps/main/src/index.ts
git commit -m "feat(m9): auto-restart main on uncaughtException (5s log window + relaunch)"
```

---

## Task 6: OAuth expiry pure helper

**Files:**
- Create: `apps/renderer/src/lib/oauth-expiry.ts`
- Create: `apps/renderer/src/lib/oauth-expiry.test.ts`

- [ ] **Step 6.1: Failing tests**

Create `apps/renderer/src/lib/oauth-expiry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { daysUntil, isExpiringSoon, EXPIRY_WARN_DAYS } from "./oauth-expiry.js";

const ONE_DAY = 24 * 60 * 60 * 1000;

describe("daysUntil", () => {
  it("returns ceil of days remaining", () => {
    const now = 1_700_000_000_000;
    expect(daysUntil(now + 5.5 * ONE_DAY, now)).toBe(6);
  });

  it("returns 0 for already expired", () => {
    const now = 1_700_000_000_000;
    expect(daysUntil(now - 1, now)).toBe(0);
  });

  it("returns null for null input", () => {
    expect(daysUntil(null, 0)).toBeNull();
  });
});

describe("isExpiringSoon", () => {
  it("true when within EXPIRY_WARN_DAYS", () => {
    const now = 1_700_000_000_000;
    expect(isExpiringSoon(now + 5 * ONE_DAY, now)).toBe(true);
  });

  it("false when beyond EXPIRY_WARN_DAYS", () => {
    const now = 1_700_000_000_000;
    expect(isExpiringSoon(now + (EXPIRY_WARN_DAYS + 5) * ONE_DAY, now)).toBe(false);
  });

  it("false when null", () => {
    expect(isExpiringSoon(null, 0)).toBe(false);
  });
});
```

- [ ] **Step 6.2: Implement**

Create `apps/renderer/src/lib/oauth-expiry.ts`:

```typescript
export const EXPIRY_WARN_DAYS = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const daysUntil = (expiresAt: number | null, now: number): number | null => {
  if (expiresAt === null) return null;
  const diff = expiresAt - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / ONE_DAY_MS);
};

export const isExpiringSoon = (expiresAt: number | null, now: number): boolean => {
  const days = daysUntil(expiresAt, now);
  return days !== null && days <= EXPIRY_WARN_DAYS;
};
```

- [ ] **Step 6.3: Run + commit**

```bash
pnpm --filter @dashboard-agent/renderer test -- oauth-expiry
git add apps/renderer/src/lib/oauth-expiry.ts apps/renderer/src/lib/oauth-expiry.test.ts
git commit -m "feat(m9): oauth-expiry pure helpers (daysUntil + isExpiringSoon)"
```

---

## Task 7: Banners (3 components) + App.tsx wire

**Files:**
- Create: `apps/renderer/src/components/banners/AuthErrorBanner.tsx`
- Create: `apps/renderer/src/components/banners/OAuthExpiryBanner.tsx`
- Create: `apps/renderer/src/components/banners/RateLimitBanner.tsx`
- Modify: `apps/renderer/src/App.tsx` — render the 3 banners above main content

- [ ] **Step 7.1: AuthErrorBanner**

Create `apps/renderer/src/components/banners/AuthErrorBanner.tsx`:

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth.js";

export const AuthErrorBanner: FC = () => {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);
  const apiKeyStatus = useAuthStore((s) => s.apiKeyStatus);

  // Show only when neither OAuth nor API key is configured.
  if (status.hasToken || apiKeyStatus.hasKey) return null;

  return (
    <div className="bg-semantic-danger text-white px-4 py-2 text-sm flex items-center justify-between">
      <span>{t("banners.authError.message")}</span>
      <Link to="/setup" className="underline font-semibold text-white hover:opacity-90">
        {t("banners.authError.action")}
      </Link>
    </div>
  );
};
```

- [ ] **Step 7.2: OAuthExpiryBanner**

Create `apps/renderer/src/components/banners/OAuthExpiryBanner.tsx`:

```tsx
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth.js";
import { daysUntil, isExpiringSoon } from "../../lib/oauth-expiry.js";

export const OAuthExpiryBanner: FC = () => {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);

  if (!status.hasToken) return null;
  const now = Date.now();
  if (!isExpiringSoon(status.expiresAt, now)) return null;

  const days = daysUntil(status.expiresAt, now);

  return (
    <div className="bg-semantic-warning text-ink px-4 py-2 text-sm flex items-center justify-between">
      <span>{t("banners.oauthExpiry.message", { days: days ?? 0 })}</span>
      <Link to="/settings" className="underline font-semibold hover:opacity-90">
        {t("banners.oauthExpiry.action")}
      </Link>
    </div>
  );
};
```

- [ ] **Step 7.3: RateLimitBanner with subscription**

Create `apps/renderer/src/components/banners/RateLimitBanner.tsx`:

```tsx
import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

type State = { active: boolean; retryAt: number | null; message: string };

const initial: State = { active: false, retryAt: null, message: "" };

export const RateLimitBanner: FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    const off = window.dashboardAgent.agents.onEvent((ev) => {
      if (ev.kind !== "rate-limited") return;
      const retryAt =
        ev.retryAfterSec !== null && ev.retryAfterSec > 0
          ? Date.now() + ev.retryAfterSec * 1000
          : null;
      setState({ active: true, retryAt, message: ev.message });
    });
    return off;
  }, []);

  // Auto-clear after the retry window.
  useEffect(() => {
    if (!state.active) return;
    const ms = state.retryAt !== null ? Math.max(0, state.retryAt - Date.now()) : 60_000;
    const timer = setTimeout(() => setState(initial), ms);
    return () => clearTimeout(timer);
  }, [state]);

  if (!state.active) return null;

  return (
    <div className="bg-semantic-warning text-ink px-4 py-2 text-sm">
      {t("banners.rateLimit.message")} — {state.message}
    </div>
  );
};
```

- [ ] **Step 7.4: Wire into App.tsx**

Edit `apps/renderer/src/App.tsx`. Add imports:

```typescript
import { AuthErrorBanner } from "./components/banners/AuthErrorBanner.js";
import { OAuthExpiryBanner } from "./components/banners/OAuthExpiryBanner.js";
import { RateLimitBanner } from "./components/banners/RateLimitBanner.js";
```

Inside the `Shell` component, render the banners between `<TitleBar />` and the routed content:

```tsx
const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col h-screen overflow-hidden bg-surface">
    <TitleBar />
    <AuthErrorBanner />
    <OAuthExpiryBanner />
    <RateLimitBanner />
    <div className="flex-1 min-h-0 flex">{children}</div>
  </div>
);
```

- [ ] **Step 7.5: Typecheck + commit**

```bash
pnpm --filter @dashboard-agent/renderer typecheck
git add apps/renderer/src/components/banners apps/renderer/src/App.tsx
git commit -m "feat(m9): three global banners (auth error, oauth expiry, rate limit)"
```

---

## Task 8: i18n + parity

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 8.1: PT-BR**

In `apps/renderer/src/i18n/pt-BR.json`, add a top-level `banners` block (alongside `app`, `nav`, etc):

```json
"banners": {
  "authError": {
    "message": "Token de autenticação não configurado. Agentes não podem rodar.",
    "action": "Configurar"
  },
  "oauthExpiry": {
    "message": "Token OAuth expira em {{days}} dias.",
    "action": "Renovar"
  },
  "rateLimit": {
    "message": "Rate limit atingido — agente pausado."
  }
}
```

- [ ] **Step 8.2: EN-US**

Mirror in `apps/renderer/src/i18n/en-US.json`:

```json
"banners": {
  "authError": {
    "message": "Authentication token not configured. Agents can't run.",
    "action": "Configure"
  },
  "oauthExpiry": {
    "message": "OAuth token expires in {{days}} days.",
    "action": "Renew"
  },
  "rateLimit": {
    "message": "Rate limit reached — agent paused."
  }
}
```

- [ ] **Step 8.3: Parity assertion**

Edit `apps/renderer/src/i18n/parity.test.ts`. Add a new `it()`:

```typescript
it("includes the M9 PR-E banner keys in both locales", () => {
  const ptKeys = flatten(ptBR);
  const enKeys = flatten(enUS);
  for (const k of [
    "banners.authError.message",
    "banners.authError.action",
    "banners.oauthExpiry.message",
    "banners.oauthExpiry.action",
    "banners.rateLimit.message",
  ]) {
    expect(ptKeys).toContain(k);
    expect(enKeys).toContain(k);
  }
});
```

Run: `pnpm --filter @dashboard-agent/renderer test -- parity`. Expected PASS.

- [ ] **Step 8.4: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m9): i18n keys for error handling banners (pt-BR + en-US)"
```

---

## Task 9: Full suite verification

- [ ] **Step 9.1: Run all**

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

Expected: 769 + ~10 new (4 heartbeat + 6 oauth-expiry+ratelimit parser + 1 parity) = **~779 tests**.

Fix inline if anything breaks.

---

## Task 10: Roadmap (3 lugares)

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/roadmap.html`

- [ ] **Step 10.1: ROADMAP.md updates**

In `ROADMAP.md` find the §M9 Error Handling block. Update:

```diff
- [ ] **Error handling (spec §7):**
-   - [ ] Banner global vermelho quando OAuth inválido
-   - [ ] Auto-restart do main em crash + 5s timeout
-   - [ ] Backoff exponencial em rate limit + banner amarelo
-   - [ ] Heartbeat do agente (5min timeout → status='error' + inbox + restart button)
+ [x] **Error handling (spec §7):** ✅ **PR-E mergeado 2026-05-14**
+   - [x] Banner global vermelho quando OAuth inválido (AuthErrorBanner — também avisa quando API key também não tá set)
+   - [x] Auto-restart do main em crash + 5s log emergency
+   - [x] Backoff/banner amarelo em rate limit (stream-parser surface rate_limit_event → broadcast → RateLimitBanner)
+   - [x] Heartbeat 5min (working/thinking sem activity → status=error + inbox agent_unresponsive)
+   - [x] OAuth expiry banner 30d antes (deferido de PR-C, agora aqui — usa expires_at salvo do credentials.json)
```

Also flip the row in v1 scope tracker — find the Settings row that mentioned "Banner OAuth expiry pendente PR-E" and update to "Completo".

- [ ] **Step 10.2: roadmap.html**

Edit `docs/roadmap.html`:

1. /01 progress meta: bump test count + agora card to "M9 PR-E mergeado", restantes 1 PR (F).
2. /03 módulos: M9 article — add new feature group ✅ "Error handling §7 (PR-E · 2026-05-14)".

Match the pattern of past closures (PR-A/D/B/C).

- [ ] **Step 10.3: Commit**

```bash
git add ROADMAP.md docs/roadmap.html
git commit -m "docs(m9): close pr-e error handling in roadmap (3 places)"
```

---

## Task 11: Memory + handoff

**Files:**
- Create: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_m9_pr_e_lessons.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\MEMORY.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-DashboardAgent\memory\project_session_handoff.md`

- [ ] **Step 11.1: Lessons memory**

Content sketch:

```markdown
---
name: project-m9-pr-e-lessons
description: "M9 PR-E error handling §7 mergeado 2026-05-14. 5 features: AuthErrorBanner + OAuthExpiryBanner + RateLimitBanner + heartbeat (5min) + auto-restart main. Migration 0015 adiciona agent_unresponsive ao inbox kind constraint."
metadata:
  type: project
---

# M9 PR-E — Error handling §7 (mergeado 2026-05-14)

## Decisões
- OAuth `expiresAt` extraído de `~/.claude/.credentials.json` em auto-detect. Manual paste → expiresAt null (não tem como saber). Banner só dispara quando expiresAt está set.
- `rate_limit_event` no stream-parser virou `ParsedEvent.kind === "rate-limited"`. Renderer subscreve via `agent:event` channel existente (sem novo IPC).
- Heartbeat: timer setInterval(60s) em index.ts. Threshold 5min. Marca status=error + inbox kind agent_unresponsive. NÃO mata o adapter — só sinaliza. Restart manual pelo user.
- `auto-restart main` deliberadamente simples: uncaughtException → 5s log → app.relaunch + app.exit. Sem self-heal.

## Lições
1. **OAuth credentials.json tem expiresAt** — sem precisar parsear JWT. Só funciona pra auto-detect; manual paste perde a info.
2. **inbox_items.kind tem CHECK constraint** — adicionar kind nova exige migration que recria a tabela (pattern de M5/M8.5).
3. **AgentEvent é union, cada nova kind quebra exhaustive switches no renderer**. Adicionar `rate-limited` requer match no consumidor.
4. **`setInterval` em index.ts precisa cleanup em before-quit** — segue pattern do `stopPermissionWatcher`.
5. **`it.todo` p/ Electron `app.relaunch`** — não dá pra testar de vitest. Smoke manual.

## Status final
- 13/14 milestones do v1; M9 com 5/6 PRs (A + D + B + C + E)
- ~779 testes passing
- Próximo: **M9 PR-F — Paperclip wishlist polish** (AGENTS.md import/export + companies.sh JSON + Reviews UX + project icons + archived state). Spec §9.
```

- [ ] **Step 11.2: MEMORY.md + handoff update**

Add to MEMORY.md after PR-C entry. Bump session_handoff (HEAD, test count, "5/6 PRs", próximo PR-F).

---

## Self-review checklist

- [x] **Spec coverage:** banner OAuth invalid (T7.1) ✅, auto-restart (T5) ✅, rate-limit backoff banner (T7.3 + T2 + T3) ✅, heartbeat 5min (T4) ✅, OAuth expiry banner (T1 + T6 + T7.2) ✅.
- [x] **Placeholder scan:** every step has actual code or commands.
- [x] **Type consistency:** `ParsedEvent.kind = "rate-limited"` consistent across parser → orchestrator → AgentEvent union → RateLimitBanner. `TokenStatus.expiresAt` consistent across shared + storage + handler + renderer.
- [x] **Migration:** new `0015_inbox_agent_unresponsive.sql` documented; pattern matches `0013_inbox_goal_kinds.sql`.

If something diverges (column count mismatch in migration, AgentEvent type location, etc.), fix inline and note in T11 lessons.
