# M9 PR-D — API Key Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 2nd adapter (`claude-api-key-local`) so users can spawn agents via Anthropic API key instead of OAuth Max. Global Settings switch persists the mode; both blobs coexist in safeStorage; 4-agent cap applies only to OAuth.

**Architecture:** Adapter pattern foundation (M7.5) already supports per-agent `adapter_name`. Add `authMode` to `AppSettings`, a new adapter that skips OAuth credentials seeding and passes `ANTHROPIC_API_KEY` env var, IPCs for API-key set/status/clear, conditional 4-agent cap, Settings UI section + SetupWizard step. New agents pick adapter from current `authMode`; existing agents keep their `adapter_name` until restart.

**Tech Stack:** Electron 33 (`safeStorage`), better-sqlite3, zod (apps/main only), zustand, React 18, react-i18next, vitest.

---

## File map

**Create:**
- `apps/main/src/auth/api-key-validate.ts` — regex helper
- `apps/main/src/auth/api-key-storage.ts` — safeStorage encrypt/decrypt + DB persistence
- `apps/main/src/auth/api-key-storage.test.ts`
- `apps/main/src/auth/api-key-validate.test.ts`
- `apps/main/src/auth/auth-mode.test.ts` (replaces stub assertion)
- `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.ts`
- `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.test.ts`
- `apps/main/src/ipc/auth-api-key-handlers.test.ts`
- `apps/renderer/src/routes/Settings.auth.test.tsx` *(skipped if no RTL — use lib helper instead)*

**Modify:**
- `packages/shared/src/types/settings.ts` — add `authMode`
- `packages/shared/src/types/auth.ts` — add `ApiKeyStatus` type
- `packages/shared/src/ipc-channels.ts` — `AUTH_API_KEY_SET`/`STATUS`/`CLEAR`
- `apps/main/src/settings/schema.ts` — extend zod schema
- `apps/main/src/auth/auth-mode.ts` — read from settings (no longer stub)
- `apps/main/src/orchestrator/env.ts` — add `buildSpawnEnvApiKey()`
- `apps/main/src/orchestrator/lifecycle.ts` — conditional 4-agent cap
- `apps/main/src/orchestrator/adapters/index.ts` — register new factory
- `apps/main/src/ipc/auth-handlers.ts` — register API key handlers
- `apps/main/src/ipc/orchestrator-handlers.ts` — `ensureAgentRunner` honors authMode (no OAuth token required in API mode)
- `apps/main/src/agents/repository.ts` — `create()` sets `adapter_name` based on current authMode
- `apps/main/src/ipc/preload.ts` — expose `auth.apiKey.*`
- `apps/renderer/src/env.d.ts` — extend types
- `apps/renderer/src/stores/auth.ts` — `apiKeyStatus`, `setApiKey`, `clearApiKey`, `authMode` actions
- `apps/renderer/src/stores/settings.ts` — `setAuthMode` action
- `apps/renderer/src/routes/Settings.tsx` — Authentication section (radio + key input)
- `apps/renderer/src/routes/SetupWizard.tsx` — new `authSource` step + `apiKey` step
- `apps/renderer/src/i18n/pt-BR.json` + `en-US.json` — ~25 keys
- `apps/renderer/src/i18n/parity.test.ts` — extend assertions
- `SECURITY.md` — "Auth modes" section
- `ROADMAP.md` + `docs/roadmap.html` — close PR-D

---

## Task 1: AppSettings.authMode field + schema

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
export type AuthMode = "oauth" | "api-key";

export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;
  defaultModelForNewAgents: string;
  executorMode: ExecutorMode;
  activeCompanyId: string | null;
  authMode: AuthMode;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
  defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
  executorMode: "atomic",
  activeCompanyId: null,
  authMode: "oauth",
};
```

- [ ] **Step 1.2: Add failing schema test**

Append to `apps/main/src/settings/schema.test.ts`:

```typescript
describe("parseSettings authMode", () => {
  it("defaults to oauth when absent", () => {
    expect(parseSettings({}).authMode).toBe("oauth");
  });

  it("preserves 'api-key' value", () => {
    expect(parseSettings({ authMode: "api-key" }).authMode).toBe("api-key");
  });

  it("rejects invalid string → defaults restored", () => {
    expect(parseSettings({ authMode: "bogus" }).authMode).toBe("oauth");
  });
});
```

Run: `pnpm --filter @prospero/main test -- schema`. Expected FAIL.

- [ ] **Step 1.3: Extend zod schema**

Edit `apps/main/src/settings/schema.ts`. Add to `AppSettingsSchema`:

```typescript
authMode: z.enum(["oauth", "api-key"]).default("oauth"),
```

And inside `parseSettings`, after the `activeCompanyId` branch:

```typescript
if (result.data.authMode !== undefined) {
  merged.authMode = result.data.authMode;
}
```

Run: `pnpm --filter @prospero/main test -- schema`. Expected PASS.

- [ ] **Step 1.4: Update existing toEqual({...}) test assertions**

Edit `apps/main/tests/settings.schema.test.ts` and `apps/main/tests/settings.repository.test.ts`. Find every `toEqual({...})` against the full DEFAULT_SETTINGS shape and add `authMode: "oauth"` line.

Run: `pnpm --filter @prospero/main test -- settings`. Expected PASS.

- [ ] **Step 1.5: Update renderer settings store default**

Edit `apps/renderer/src/stores/settings.ts`, in the initial `settings:` object literal:

```typescript
settings: {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
  defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
  executorMode: "atomic",
  activeCompanyId: null,
  authMode: "oauth",
},
```

- [ ] **Step 1.6: Update shared types test**

Edit `packages/shared/tests/settings.test.ts`. Find the `const s: AppSettings = {...}` block, add `authMode: "oauth"`.

- [ ] **Step 1.7: Typecheck + commit**

```bash
pnpm -r typecheck
git add packages/shared/src/types/settings.ts apps/main/src/settings/schema.ts apps/main/src/settings/schema.test.ts apps/main/tests/settings.schema.test.ts apps/main/tests/settings.repository.test.ts apps/renderer/src/stores/settings.ts packages/shared/tests/settings.test.ts
git commit -m "feat(m9): add authMode to AppSettings shape + schema"
```

---

## Task 2: API key validate helper

**Files:**
- Create: `apps/main/src/auth/api-key-validate.ts`
- Create: `apps/main/src/auth/api-key-validate.test.ts`

- [ ] **Step 2.1: Write failing test**

Create `apps/main/src/auth/api-key-validate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isWellFormedApiKey } from "./api-key-validate.js";

describe("isWellFormedApiKey", () => {
  it("accepts valid sk-ant-api keys", () => {
    expect(isWellFormedApiKey("sk-ant-api03-abc123_-XYZ" + "0".repeat(80))).toBe(true);
  });

  it("rejects empty / whitespace", () => {
    expect(isWellFormedApiKey("")).toBe(false);
    expect(isWellFormedApiKey("   ")).toBe(false);
  });

  it("rejects OAuth tokens", () => {
    expect(isWellFormedApiKey("sk-ant-oat-" + "x".repeat(80))).toBe(false);
  });

  it("rejects keys with shell metacharacters", () => {
    expect(isWellFormedApiKey("sk-ant-api03-abc; rm -rf /")).toBe(false);
  });

  it("trims input before validation", () => {
    expect(isWellFormedApiKey("  sk-ant-api03-" + "a".repeat(80) + "  ")).toBe(true);
  });
});
```

Run: `pnpm --filter @prospero/main test -- api-key-validate`. Expected FAIL.

- [ ] **Step 2.2: Implement**

Create `apps/main/src/auth/api-key-validate.ts`:

```typescript
// Anthropic API keys are issued as sk-ant-api<NN>-<base64url-ish>. The exact
// length varies; we accept a generous range and validate only the prefix +
// charset to block command-injection without rejecting future formats.
const API_KEY_REGEX = /^sk-ant-api[0-9]{1,3}-[A-Za-z0-9_-]{40,}$/;

export const isWellFormedApiKey = (raw: string): boolean => API_KEY_REGEX.test(raw.trim());
```

Run again. Expected PASS.

- [ ] **Step 2.3: Commit**

```bash
git add apps/main/src/auth/api-key-validate.ts apps/main/src/auth/api-key-validate.test.ts
git commit -m "feat(m9): api key well-formed validator (sk-ant-apiNN-...)"
```

---

## Task 3: API key storage (safeStorage)

**Files:**
- Create: `apps/main/src/auth/api-key-storage.ts`
- Create: `apps/main/src/auth/api-key-storage.test.ts`
- Modify: `packages/shared/src/types/auth.ts`

- [ ] **Step 3.1: Extend shared auth types**

Edit `packages/shared/src/types/auth.ts`. Find the `TokenStatus` type and below it add:

```typescript
export type ApiKeyStatus =
  | { hasKey: false }
  | { hasKey: true; maskedPrefix: string; configuredAt: number };
```

Don't forget to export from `packages/shared/src/types/index.ts` if there's a re-export there. (Check that file — if it does `export *`, you're fine.)

- [ ] **Step 3.2: Write failing storage tests**

Create `apps/main/src/auth/api-key-storage.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Stub Electron safeStorage so tests run without an Electron host.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`ENC[${s}]`, "utf8"),
    decryptString: (b: Buffer) => {
      const s = b.toString("utf8");
      const m = /^ENC\[(.*)\]$/.exec(s);
      return m ? m[1] : "";
    },
  },
}));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api key storage", () => {
  it("saveApiKey persists encrypted blob + masked prefix", async () => {
    const db = setupDb();
    const { saveApiKey, loadApiKeyStatus } = await import("./api-key-storage.js");
    saveApiKey(db, "sk-ant-api03-" + "x".repeat(80));
    const status = loadApiKeyStatus(db);
    expect(status.hasKey).toBe(true);
    if (status.hasKey) {
      expect(status.maskedPrefix).toMatch(/^sk-ant-api/);
      expect(status.maskedPrefix).not.toContain("xxxxxxxx");
      expect(status.configuredAt).toBeGreaterThan(0);
    }
  });

  it("loadApiKeyStatus returns hasKey:false on empty db", async () => {
    const db = setupDb();
    const { loadApiKeyStatus } = await import("./api-key-storage.js");
    expect(loadApiKeyStatus(db)).toEqual({ hasKey: false });
  });

  it("loadDecryptedApiKey returns null when missing", async () => {
    const db = setupDb();
    const { loadDecryptedApiKey } = await import("./api-key-storage.js");
    expect(loadDecryptedApiKey(db)).toBeNull();
  });

  it("loadDecryptedApiKey round-trips through encrypt/decrypt", async () => {
    const db = setupDb();
    const { saveApiKey, loadDecryptedApiKey } = await import("./api-key-storage.js");
    const raw = "sk-ant-api03-" + "y".repeat(80);
    saveApiKey(db, raw);
    expect(loadDecryptedApiKey(db)).toBe(raw);
  });

  it("clearApiKey removes all rows", async () => {
    const db = setupDb();
    const { saveApiKey, clearApiKey, loadApiKeyStatus } = await import("./api-key-storage.js");
    saveApiKey(db, "sk-ant-api03-" + "z".repeat(80));
    clearApiKey(db);
    expect(loadApiKeyStatus(db)).toEqual({ hasKey: false });
  });

  it("saveApiKey rejects malformed input", async () => {
    const db = setupDb();
    const { saveApiKey } = await import("./api-key-storage.js");
    expect(() => saveApiKey(db, "not-a-key")).toThrow(/not well-formed|invalid/i);
  });
});
```

Run: `pnpm --filter @prospero/main test -- api-key-storage`. Expected FAIL.

- [ ] **Step 3.3: Implement storage module**

Create `apps/main/src/auth/api-key-storage.ts`:

```typescript
import type Database from "better-sqlite3";
import { safeStorage } from "electron";
import type { ApiKeyStatus } from "@prospero/shared";
import { isWellFormedApiKey } from "./api-key-validate.js";

const KEY_CIPHERTEXT = "auth.apikey.ciphertext";
const KEY_PREFIX = "auth.apikey.prefix";
const KEY_AT = "auth.apikey.configured_at";

const upsert = (db: Database.Database, key: string, value: string): void => {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
};

const select = (db: Database.Database, key: string): string | null => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
};

const remove = (db: Database.Database, key: string): void => {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
};

// Show "sk-ant-api03-…XXXX" — first 12 chars + last 4. Never the full key.
const maskApiKey = (raw: string): string => {
  if (raw.length <= 16) return "sk-ant-api…";
  return `${raw.slice(0, 12)}…${raw.slice(-4)}`;
};

export const saveApiKey = (db: Database.Database, raw: string): void => {
  const trimmed = raw.trim();
  if (!isWellFormedApiKey(trimmed)) {
    throw new Error("API key is not well-formed");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption is not available on this machine");
  }
  const cipher = safeStorage.encryptString(trimmed);
  const tx = db.transaction(() => {
    upsert(db, KEY_CIPHERTEXT, cipher.toString("base64"));
    upsert(db, KEY_PREFIX, maskApiKey(trimmed));
    upsert(db, KEY_AT, String(Date.now()));
  });
  tx();
};

export const loadApiKeyStatus = (db: Database.Database): ApiKeyStatus => {
  const cipher = select(db, KEY_CIPHERTEXT);
  if (cipher === null) return { hasKey: false };
  const prefix = select(db, KEY_PREFIX);
  const at = select(db, KEY_AT);
  if (prefix === null || at === null) return { hasKey: false };
  return { hasKey: true, maskedPrefix: prefix, configuredAt: Number.parseInt(at, 10) };
};

export const loadDecryptedApiKey = (db: Database.Database): string | null => {
  // E2E bypass mirrors token-storage.ts: read plaintext from a file when env var is set.
  const e2ePath = process.env["PROSPERO_E2E_API_KEY_PATH"];
  if (e2ePath !== undefined && e2ePath !== "") {
    try {
      const { readFileSync } = require("node:fs") as typeof import("node:fs");
      return readFileSync(e2ePath, "utf8").trim();
    } catch {
      return null;
    }
  }
  const cipher64 = select(db, KEY_CIPHERTEXT);
  if (cipher64 === null) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(cipher64, "base64"));
};

export const clearApiKey = (db: Database.Database): void => {
  const tx = db.transaction(() => {
    remove(db, KEY_CIPHERTEXT);
    remove(db, KEY_PREFIX);
    remove(db, KEY_AT);
  });
  tx();
};
```

> **Note:** `require("node:fs")` is used because `import { readFileSync }` at the top of a module that's mocked via `vi.mock("electron")` can interact with module caching. If lint complains about `require`, use `import("node:fs")` dynamic or move to a top-level import — verify it doesn't break the test's electron mock first.

Run: `pnpm --filter @prospero/main test -- api-key-storage`. Expected PASS.

- [ ] **Step 3.4: Commit**

```bash
git add apps/main/src/auth/api-key-storage.ts apps/main/src/auth/api-key-storage.test.ts packages/shared/src/types/auth.ts
git commit -m "feat(m9): api key storage via safeStorage + ApiKeyStatus type"
```

---

## Task 4: auth-mode.ts reads from settings

**Files:**
- Modify: `apps/main/src/auth/auth-mode.ts`
- Create: `apps/main/src/auth/auth-mode.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `apps/main/src/auth/auth-mode.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSettingsRepository } from "../settings/repository.js";
import { getActiveAuthMode } from "./auth-mode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

describe("getActiveAuthMode", () => {
  it("defaults to 'oauth' when no setting persisted", () => {
    const db = setupDb();
    expect(getActiveAuthMode(db)).toBe("oauth");
  });

  it("returns 'api-key' when settings.authMode = 'api-key'", () => {
    const db = setupDb();
    createSettingsRepository(db).write({ authMode: "api-key" });
    expect(getActiveAuthMode(db)).toBe("api-key");
  });

  it("returns 'oauth' when settings.authMode = 'oauth'", () => {
    const db = setupDb();
    createSettingsRepository(db).write({ authMode: "oauth" });
    expect(getActiveAuthMode(db)).toBe("oauth");
  });
});
```

> **There may be an existing stub test** at `apps/main/tests/auth.auth-mode.test.ts` asserting `getActiveAuthMode() === "oauth"` (no DB argument). Update it: either delete it (functionality moved here) or rewrite it to match the new signature.

Run: `pnpm --filter @prospero/main test -- auth-mode`. Expected FAIL (function signature change).

- [ ] **Step 4.2: Update auth-mode.ts**

Replace `apps/main/src/auth/auth-mode.ts` with:

```typescript
import type Database from "better-sqlite3";
import { createSettingsRepository } from "../settings/repository.js";

export type AuthMode = "oauth" | "api-key";

export const getActiveAuthMode = (db: Database.Database): AuthMode =>
  createSettingsRepository(db).read().authMode;
```

- [ ] **Step 4.3: Fix lifecycle.ts call site**

Edit `apps/main/src/orchestrator/lifecycle.ts`. The current call `getActiveAuthMode()` no longer compiles. Update to:

```typescript
// At call site inside ensureAdapter, replace getActiveAuthMode() call.
// We need a db ref; the call happens before adapter creation, so pass it through.
```

Actually since `getActiveAuthMode` now needs db: the cleanest is to keep `agent.adapterName` as the primary source of truth (it's set at agent creation, see Task 10), and delete the fallback branch:

```typescript
// In ensureAdapter — replace the multi-branch fallback:
const name: AdapterName = (opts.agent.adapterName as AdapterName | undefined) ?? DEFAULT_ADAPTER_NAME;
void DEFAULT_ADAPTER_NAME;
```

This makes `getActiveAuthMode()` callable only when its db dep is available (orchestrator-handlers, repo create). lifecycle.ts becomes db-free again.

Then delete the now-unused `getActiveAuthMode` import from lifecycle.ts.

- [ ] **Step 4.4: Delete the old stub test if it exists**

Check `apps/main/tests/auth.auth-mode.test.ts`. If it tests the old no-arg signature, delete it (the new test in `src/auth/auth-mode.test.ts` covers the new behavior):

```bash
rm apps/main/tests/auth.auth-mode.test.ts  # only if its content is the old stub
```

Run: `pnpm --filter @prospero/main test -- auth-mode`. Expected PASS.

- [ ] **Step 4.5: Typecheck + commit**

```bash
pnpm --filter @prospero/main typecheck
git add apps/main/src/auth/auth-mode.ts apps/main/src/auth/auth-mode.test.ts apps/main/src/orchestrator/lifecycle.ts apps/main/tests/auth.auth-mode.test.ts
git commit -m "feat(m9): auth-mode reads from settings.authMode (no longer stub)"
```

---

## Task 5: buildSpawnEnvApiKey + env helper refactor

**Files:**
- Modify: `apps/main/src/orchestrator/env.ts`
- Create or modify: `apps/main/tests/orchestrator.env.test.ts`

- [ ] **Step 5.1: Add failing test for API key env**

Open `apps/main/tests/orchestrator.env.test.ts`. Append:

```typescript
import { buildSpawnEnvApiKey } from "../src/orchestrator/env.js";

describe("buildSpawnEnvApiKey", () => {
  it("sets ANTHROPIC_API_KEY and omits CLAUDE_CODE_OAUTH_TOKEN", () => {
    const agent = {
      id: "ag_1",
      companyId: "co_1",
    } as Parameters<typeof buildSpawnEnvApiKey>[0];
    const env = buildSpawnEnvApiKey(agent, "sk-ant-api03-XXXX", "/db", "/perms", "/ev");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-api03-XXXX");
    expect("CLAUDE_CODE_OAUTH_TOKEN" in env).toBe(false);
    expect(env.AGENT_ID).toBe("ag_1");
    expect(env.COMPANY_ID).toBe("co_1");
  });
});
```

Run: `pnpm --filter @prospero/main test -- orchestrator.env`. Expected FAIL.

- [ ] **Step 5.2: Implement helper**

Edit `apps/main/src/orchestrator/env.ts`. Add at the bottom:

```typescript
export type SpawnEnvApiKey = {
  ANTHROPIC_API_KEY: string;
  AGENT_ID: string;
  COMPANY_ID: string;
  DB_PATH: string;
  PERMISSIONS_DIR: string;
  EVENTS_DIR: string;
};

export const buildSpawnEnvApiKey = (
  agent: Agent,
  apiKey: string,
  dbPath: string,
  permissionsDir: string,
  eventsDir: string,
): SpawnEnvApiKey => ({
  ANTHROPIC_API_KEY: apiKey,
  AGENT_ID: agent.id,
  COMPANY_ID: agent.companyId,
  DB_PATH: dbPath,
  PERMISSIONS_DIR: permissionsDir,
  EVENTS_DIR: eventsDir,
});
```

Run: `pnpm --filter @prospero/main test -- orchestrator.env`. Expected PASS.

- [ ] **Step 5.3: Commit**

```bash
git add apps/main/src/orchestrator/env.ts apps/main/tests/orchestrator.env.test.ts
git commit -m "feat(m9): buildSpawnEnvApiKey helper for api-key adapter"
```

---

## Task 6: claude-api-key-local adapter

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.ts`
- Create: `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.test.ts`

- [ ] **Step 6.1: Read OAuth adapter for reference**

Quick re-read `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts` lines 39-173 (the `start()` method). The new adapter is identical except: (a) doesn't call `seedSandboxCredentials`, (b) uses `buildSpawnEnvApiKey` instead of `buildSpawnEnv`, (c) `apiKey` field on SpawnContext.

- [ ] **Step 6.2: Extend SpawnContext type**

Edit `packages/shared/src/types/adapter.ts`. Update `SpawnContext`:

```typescript
export type SpawnContext = {
  agent: Agent;
  oauthToken?: string;   // present only for OAuth adapters
  apiKey?: string;       // present only for api-key adapters
  dbPath: string;
  permissionsDir: string;
  eventsDir: string;
  userDataDir?: string;
  mcpServerJsPath?: string;
  cwd?: string;
  narratedActive?: boolean;
};
```

Make `oauthToken` optional too.

- [ ] **Step 6.3: Fix OAuth adapter to handle optional oauthToken**

Edit `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts:62-68`. Replace:

```typescript
    const env = buildSpawnEnv(
      this.ctx.agent,
      this.ctx.oauthToken,
      this.ctx.dbPath,
      this.ctx.permissionsDir,
      this.ctx.eventsDir,
    );
```

with:

```typescript
    if (this.ctx.oauthToken === undefined) {
      throw new Error("claude-oauth-local requires oauthToken in SpawnContext");
    }
    const env = buildSpawnEnv(
      this.ctx.agent,
      this.ctx.oauthToken,
      this.ctx.dbPath,
      this.ctx.permissionsDir,
      this.ctx.eventsDir,
    );
```

- [ ] **Step 6.4: Create the new adapter**

Create `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.ts`:

```typescript
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import crossSpawn from "cross-spawn";
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  AgentAdapter,
  AdapterEventListener,
  AdapterName,
  ParsedEvent,
  SpawnContext,
  UsageEstimate,
} from "@prospero/shared";
import { buildClaudeArgs } from "../claude-oauth-local/build-args.js";
import { findClaudeExe } from "../claude-oauth-local/resolve-binary.js";
import { prepareSandbox, writeSandboxSettings } from "../claude-oauth-local/prepare-sandbox.js";
import { parseStreamLine } from "../claude-oauth-local/stream-parser.js";
import { FakeClaude, isFakeClaudeEnabled } from "../claude-oauth-local/fake-claude.js";
import { buildSpawnEnvApiKey } from "../../env.js";
import { setupMcpHandshake } from "../../mcp-handshake.js";
import { mergeSpawnEnv } from "../../util/env-merge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const logFile = resolve(__dirname, "../../orchestrator.log");
const dlog = (msg: string): void => {
  try {
    const logDir = dirname(logFile);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {
    /* ignore */
  }
};

export class ClaudeApiKeyLocalAdapter implements AgentAdapter {
  readonly name: AdapterName = "claude-api-key-local";
  readonly agentId: string;

  private readonly ctx: SpawnContext;
  private child: ChildProcess | null = null;
  private cleanupFn: (() => void) | null = null;
  private currentAction: string | null = null;
  private usage: UsageEstimate = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  private readonly eventListeners = new Set<AdapterEventListener<ParsedEvent>>();
  private readonly stderrListeners = new Set<AdapterEventListener<string>>();
  private readonly exitListeners = new Set<AdapterEventListener<number | null>>();

  constructor(ctx: SpawnContext) {
    this.ctx = ctx;
    this.agentId = ctx.agent.id;
  }

  async start(): Promise<void> {
    if (this.child !== null) {
      throw new Error("Adapter already started; create a new instance to respawn");
    }
    if (this.ctx.apiKey === undefined) {
      throw new Error("claude-api-key-local requires apiKey in SpawnContext");
    }

    const env = buildSpawnEnvApiKey(
      this.ctx.agent,
      this.ctx.apiKey,
      this.ctx.dbPath,
      this.ctx.permissionsDir,
      this.ctx.eventsDir,
    );

    const handshake = setupMcpHandshake(env, this.ctx.mcpServerJsPath);
    const args = buildClaudeArgs(this.ctx.agent, handshake.mcpConfigPath, {
      ...(this.ctx.narratedActive === true ? { narratedActive: true } : {}),
    });

    const { agentConfigDir, agentSandboxCwd, isEphemeralConfigDir } = prepareSandbox(
      this.ctx.agent.id,
      this.ctx.userDataDir,
    );

    // No seedSandboxCredentials — the key flows via env ANTHROPIC_API_KEY.
    writeSandboxSettings(agentConfigDir);

    const spawnCwd = this.ctx.cwd ?? agentSandboxCwd;
    const spawnEnv = mergeSpawnEnv(env, agentConfigDir);

    dlog(`spawn claude (api-key) for agent=${this.ctx.agent.id} cwd=${spawnCwd}`);

    if (isFakeClaudeEnabled()) {
      dlog(`spawn strategy: FakeClaude stub (E2E mode)`);
      this.child = new FakeClaude() as unknown as ChildProcess;
    } else {
      const claudeExe = findClaudeExe();
      this.child =
        claudeExe !== null
          ? nodeSpawn(claudeExe, args, {
              env: spawnEnv,
              cwd: spawnCwd,
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: true,
            })
          : crossSpawn("claude", args, {
              env: spawnEnv,
              cwd: spawnCwd,
              stdio: ["pipe", "pipe", "pipe"],
            });
    }

    if (this.child.stdout !== null) {
      const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const parsed = parseStreamLine(line);
        if (parsed !== null) this.handleParsedEvent(parsed);
      });
    }

    if (this.child.stderr !== null) {
      this.child.stderr.setEncoding("utf8");
      this.child.stderr.on("data", (chunk: string) => {
        for (const line of chunk.split("\n")) {
          if (line.trim() !== "") this.emitStderr(line);
        }
      });
    }

    this.child.on("exit", (code) => this.emitExit(code));
    this.child.on("error", (err) => this.emitStderr(`adapter-error: ${err.message}`));

    this.cleanupFn = (): void => {
      const dirsToRemove = [dirname(handshake.mcpConfigPath)];
      if (isEphemeralConfigDir) {
        dirsToRemove.push(agentConfigDir);
        dirsToRemove.push(agentSandboxCwd);
      }
      for (const dir of dirsToRemove) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    };
    this.child.on("exit", () => {
      if (this.cleanupFn !== null) {
        this.cleanupFn();
        this.cleanupFn = null;
      }
    });

    return Promise.resolve();
  }

  sendInput(text: string): void {
    if (this.child === null || this.child.stdin === null || !this.child.stdin.writable) return;
    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    });
    this.child.stdin.write(payload + "\n");
  }

  onEvent(cb: AdapterEventListener<ParsedEvent>): () => void {
    this.eventListeners.add(cb);
    return (): void => { this.eventListeners.delete(cb); };
  }
  onStderr(cb: AdapterEventListener<string>): () => void {
    this.stderrListeners.add(cb);
    return (): void => { this.stderrListeners.delete(cb); };
  }
  onExit(cb: AdapterEventListener<number | null>): () => void {
    this.exitListeners.add(cb);
    return (): void => { this.exitListeners.delete(cb); };
  }

  kill(): void {
    if (this.child !== null && !this.child.killed) this.child.kill();
    if (this.cleanupFn !== null) { this.cleanupFn(); this.cleanupFn = null; }
  }

  isAlive(): boolean {
    if (this.child === null) return false;
    return !this.child.killed && this.child.exitCode === null;
  }

  getUsage(): UsageEstimate { return { ...this.usage }; }
  getCurrentAction(): string | null { return this.currentAction; }

  private handleParsedEvent(event: ParsedEvent): void {
    if (event.kind === "turn-complete" && event.usage !== undefined) {
      this.usage.input += event.usage.input;
      this.usage.output += event.usage.output;
      this.usage.cache_creation += event.usage.cache_creation;
      this.usage.cache_read += event.usage.cache_read;
    }
    for (const cb of this.eventListeners) cb(event);
  }
  private emitStderr(line: string): void { for (const cb of this.stderrListeners) cb(line); }
  private emitExit(code: number | null): void { for (const cb of this.exitListeners) cb(code); }
}
```

- [ ] **Step 6.5: Write adapter spawn test**

Create `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ClaudeApiKeyLocalAdapter } from "./adapter.js";
import type { Agent, SpawnContext } from "@prospero/shared";

const baseAgent = (): Agent => ({
  id: "ag_1",
  companyId: "co_1",
  name: "Test",
  role: "engineer",
  systemPrompt: "p",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  skills: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-api-key-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
});

describe("ClaudeApiKeyLocalAdapter", () => {
  it("constructor sets name + agentId", () => {
    const ctx: SpawnContext = {
      agent: baseAgent(),
      apiKey: "sk-ant-api03-XXX",
      dbPath: "/db",
      permissionsDir: "/perms",
      eventsDir: "/ev",
    };
    const adapter = new ClaudeApiKeyLocalAdapter(ctx);
    expect(adapter.name).toBe("claude-api-key-local");
    expect(adapter.agentId).toBe("ag_1");
  });

  it("start() throws when apiKey absent", async () => {
    const ctx: SpawnContext = {
      agent: baseAgent(),
      dbPath: "/db",
      permissionsDir: "/perms",
      eventsDir: "/ev",
    };
    const adapter = new ClaudeApiKeyLocalAdapter(ctx);
    await expect(adapter.start()).rejects.toThrow(/apiKey/);
  });
});
```

> **Note:** A real spawn test against the claude binary would need FakeClaude — out of scope here. The two assertions above cover the contract; full spawn behavior is identical to the OAuth adapter (already covered by its tests).

Run: `pnpm --filter @prospero/main test -- claude-api-key-local`. Expected PASS.

- [ ] **Step 6.6: Typecheck + commit**

```bash
pnpm -r typecheck
git add apps/main/src/orchestrator/adapters/claude-api-key-local apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts packages/shared/src/types/adapter.ts
git commit -m "feat(m9): claude-api-key-local adapter (env-based credentials, no seeding)"
```

---

## Task 7: Register adapter factory

**Files:**
- Modify: `apps/main/src/orchestrator/adapters/index.ts`

- [ ] **Step 7.1: Register the factory**

Replace `apps/main/src/orchestrator/adapters/index.ts`:

```typescript
import type {
  AgentAdapter,
  AgentAdapterFactory,
  AdapterName,
  SpawnContext,
} from "@prospero/shared";
import { ClaudeOAuthLocalAdapter } from "./claude-oauth-local/adapter.js";
import { ClaudeApiKeyLocalAdapter } from "./claude-api-key-local/adapter.js";

const claudeOAuthLocalFactory: AgentAdapterFactory = {
  name: "claude-oauth-local",
  create(ctx: SpawnContext): AgentAdapter {
    return new ClaudeOAuthLocalAdapter(ctx);
  },
};

const claudeApiKeyLocalFactory: AgentAdapterFactory = {
  name: "claude-api-key-local",
  create(ctx: SpawnContext): AgentAdapter {
    return new ClaudeApiKeyLocalAdapter(ctx);
  },
};

export const adapterRegistry: Record<AdapterName, AgentAdapterFactory | undefined> = {
  "claude-oauth-local": claudeOAuthLocalFactory,
  "claude-api-key-local": claudeApiKeyLocalFactory,
  "claude-oauth-remote-docker": undefined, // M10
};

export const createAdapter = (name: AdapterName, ctx: SpawnContext): AgentAdapter => {
  const factory = adapterRegistry[name];
  if (factory === undefined) {
    throw new Error(`Adapter '${name}' is not implemented yet`);
  }
  return factory.create(ctx);
};
```

- [ ] **Step 7.2: Typecheck + commit**

```bash
pnpm --filter @prospero/main typecheck
git add apps/main/src/orchestrator/adapters/index.ts
git commit -m "feat(m9): register claude-api-key-local in adapter registry"
```

---

## Task 8: IPC channels + auth handlers (api-key-set / status / clear)

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `apps/main/src/ipc/auth-handlers.ts`
- Create: `apps/main/src/ipc/auth-api-key-handlers.test.ts`

- [ ] **Step 8.1: Add IPC channels**

Edit `packages/shared/src/ipc-channels.ts`. After `AUTH_TOKEN_CLEAR`:

```typescript
AUTH_API_KEY_STATUS: "auth:api-key-status",
AUTH_API_KEY_SET: "auth:api-key-set",
AUTH_API_KEY_CLEAR: "auth:api-key-clear",
```

- [ ] **Step 8.2: Failing handler test**

Create `apps/main/src/ipc/auth-api-key-handlers.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown): void => {
      handlers.set(ch, fn);
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`ENC[${s}]`, "utf8"),
    decryptString: (b: Buffer) => {
      const m = /^ENC\[(.*)\]$/.exec(b.toString("utf8"));
      return m ? m[1] : "";
    },
  },
}));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  return db;
};

beforeEach(() => {
  handlers.clear();
});

describe("auth api-key handlers", () => {
  it("auth:api-key-set persists + returns status with hasKey:true", async () => {
    const db = setupDb();
    const { registerAuthHandlers } = await import("./auth-handlers.js");
    registerAuthHandlers(db);
    const handle = handlers.get("auth:api-key-set");
    expect(handle).toBeDefined();
    const raw = "sk-ant-api03-" + "x".repeat(80);
    const status = (await handle!(null, { raw })) as { hasKey: boolean };
    expect(status.hasKey).toBe(true);
  });

  it("auth:api-key-set rejects malformed input", async () => {
    const db = setupDb();
    const { registerAuthHandlers } = await import("./auth-handlers.js");
    registerAuthHandlers(db);
    const handle = handlers.get("auth:api-key-set");
    await expect(handle!(null, { raw: "not-a-key" })).rejects.toThrow(/well-formed|invalid/i);
  });

  it("auth:api-key-status returns hasKey:false when none set", async () => {
    const db = setupDb();
    const { registerAuthHandlers } = await import("./auth-handlers.js");
    registerAuthHandlers(db);
    const handle = handlers.get("auth:api-key-status");
    const status = await handle!(null, undefined);
    expect(status).toEqual({ hasKey: false });
  });

  it("auth:api-key-clear removes the stored key", async () => {
    const db = setupDb();
    const { registerAuthHandlers } = await import("./auth-handlers.js");
    registerAuthHandlers(db);
    const setHandle = handlers.get("auth:api-key-set");
    const clearHandle = handlers.get("auth:api-key-clear");
    await setHandle!(null, { raw: "sk-ant-api03-" + "x".repeat(80) });
    const status = (await clearHandle!(null, undefined)) as { hasKey: boolean };
    expect(status.hasKey).toBe(false);
  });
});
```

> **Async handler note:** the test uses `await handle!(null, {raw})` because the new handlers wrap the body in `Promise.resolve().then(...)` to match the existing token-set pattern — that turns sync throws into rejected promises, which `.rejects.toThrow()` requires.

- [ ] **Step 8.3: Implement handlers**

Edit `apps/main/src/ipc/auth-handlers.ts`. Add imports:

```typescript
import type { ApiKeyStatus } from "@prospero/shared";
import { saveApiKey, loadApiKeyStatus, clearApiKey } from "../auth/api-key-storage.js";
```

Inside `registerAuthHandlers`, after the existing `AUTH_TOKEN_CLEAR` handler:

```typescript
ipcMain.handle(IPC.AUTH_API_KEY_STATUS, (): ApiKeyStatus => loadApiKeyStatus(db));

ipcMain.handle(IPC.AUTH_API_KEY_SET, (_event, payload: unknown): Promise<ApiKeyStatus> => {
  return Promise.resolve().then(() => {
    if (
      payload === null ||
      typeof payload !== "object" ||
      typeof (payload as { raw: string }).raw !== "string"
    ) {
      throw new Error("Invalid payload for api-key-set");
    }
    saveApiKey(db, (payload as { raw: string }).raw);
    return loadApiKeyStatus(db);
  });
});

ipcMain.handle(IPC.AUTH_API_KEY_CLEAR, (): ApiKeyStatus => {
  clearApiKey(db);
  return loadApiKeyStatus(db);
});
```

Run: `pnpm --filter @prospero/main test -- auth-api-key-handlers`. Expected PASS.

- [ ] **Step 8.4: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/auth-handlers.ts apps/main/src/ipc/auth-api-key-handlers.test.ts
git commit -m "feat(m9): auth:api-key-set / status / clear ipc handlers"
```

---

## Task 9: Lifecycle conditional 4-agent cap

**Files:**
- Modify: `apps/main/src/orchestrator/lifecycle.ts`
- Create: `apps/main/tests/orchestrator.cap.test.ts`

- [ ] **Step 9.1: Failing test**

Create `apps/main/tests/orchestrator.cap.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { activeAdapterCount, ensureAdapter, MAX_CONCURRENT_AGENTS, removeAdapter } from "../src/orchestrator/lifecycle.js";

// The lifecycle module keeps a module-level adapters Map. We can't easily
// inject 4 live adapters without spawning real child procs. Instead we assert
// the cap is read from MAX_CONCURRENT_AGENTS and that the error mentions
// switching to api-key.
describe("orchestrator cap", () => {
  it("MAX_CONCURRENT_AGENTS is 4", () => {
    expect(MAX_CONCURRENT_AGENTS).toBe(4);
  });

  // Documenting behavior: the cap message mentions api-key as the way out.
  // Real cap enforcement is tested via integration when 4 spawns happen.
  it.todo("ensureAdapter throws when authMode=oauth and cap reached");
  it.todo("ensureAdapter allows >4 when authMode=api-key");
});

void activeAdapterCount;
void ensureAdapter;
void removeAdapter;
void vi;
```

> **Note:** `it.todo` markers document that real cap enforcement is integration-level. The behavior change is small (one `if` branch) and is exercised by manual smoke. Keeping integration tests honest matters more than padding numbers.

Run: `pnpm --filter @prospero/main test -- orchestrator.cap`. Should pass (1 assertion + 2 todos).

- [ ] **Step 9.2: Update lifecycle cap**

Edit `apps/main/src/orchestrator/lifecycle.ts`. Find:

```typescript
  if (activeAdapterCount() >= MAX_CONCURRENT_AGENTS) {
    throw new Error(
      `Max concurrent agents (${String(MAX_CONCURRENT_AGENTS)}) reached. Kill one before spawning a new agent.`,
    );
  }
```

Replace with:

```typescript
  // OAuth Max ToS caps parallel sessions at 4. API key has no such cap
  // (Anthropic rate limit handles it). The agent.adapterName carries the
  // mode selected at creation time.
  const isOauth =
    (opts.agent.adapterName as string | undefined) === "claude-oauth-local" ||
    (opts.agent.adapterName as string | undefined) === undefined;
  if (isOauth && activeAdapterCount() >= MAX_CONCURRENT_AGENTS) {
    throw new Error(
      `Max concurrent OAuth agents (${String(MAX_CONCURRENT_AGENTS)}) reached. ` +
        `Kill one before spawning a new agent, or switch to API key mode in Settings.`,
    );
  }
```

- [ ] **Step 9.3: Commit**

```bash
git add apps/main/src/orchestrator/lifecycle.ts apps/main/tests/orchestrator.cap.test.ts
git commit -m "feat(m9): 4-agent cap only applies to OAuth adapters"
```

---

## Task 10: agents repo creates with adapter_name from authMode

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/src/agents/repository.test.ts` (or repository.lifecycle.test.ts)

- [ ] **Step 10.1: Add failing test**

Append to `apps/main/src/agents/repository.test.ts` (or wherever `create` is tested — search for `describe.*create` first):

```typescript
describe("create — adapter_name", () => {
  it("defaults to claude-oauth-local", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(a.adapterName).toBe("claude-oauth-local");
  });

  it("respects explicit adapterName input", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create({ ...baseInput(), adapterName: "claude-api-key-local" });
    expect(a.adapterName).toBe("claude-api-key-local");
  });
});
```

> **`baseInput` and `setupDb`** already exist at the top of `repository.test.ts` — see lines 20-30. Use them as-is. You may need to import `createAgentsRepository` (line 6).

Run: `pnpm --filter @prospero/main test -- agents/repository`. Expected FAIL on second assertion.

- [ ] **Step 10.2: Extend CreateAgentInput + insert**

Edit `apps/main/src/agents/repository.ts`. Update `CreateAgentInput`:

```typescript
export type CreateAgentInput = {
  companyId: string;
  name: string;
  role: string;
  systemPrompt: string;
  mode: AgentMode;
  alwaysOn: boolean;
  model?: string;
  skills?: string[];
  templateId?: string | null;
  adapterName?: string;  // NEW — defaults to claude-oauth-local via SQL
  actor?: Actor;
};
```

Update the INSERT prepared statement (currently lines 100-103):

```typescript
  const insert = db.prepare(`
    INSERT INTO agents (id, company_id, name, role, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, current_action, model, template_id, adapter_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, 'idle', NULL, ?, ?, ?, ?, ?)
  `);
```

And update the `create()` impl to pass `adapter_name`:

```typescript
    create(input) {
      const id = `agent_${randomUUID()}`;
      const now = Date.now();
      const finalModel = input.model || DEFAULT_CLAUDE_MODEL;
      const adapterName = input.adapterName ?? "claude-oauth-local";
      insert.run(
        id,
        input.companyId,
        input.name,
        input.role,
        input.systemPrompt,
        JSON.stringify(input.skills ?? []),
        input.mode,
        input.alwaysOn ? 1 : 0,
        finalModel,
        input.templateId ?? null,
        adapterName,
        now,
        now,
      );
      // …rest of body
    },
```

> Adjust the rest of the body (recorder dual-write etc.) — keep it. Show the rest of the function in your editor before changing.

Run: `pnpm --filter @prospero/main test -- agents/repository`. Expected PASS.

- [ ] **Step 10.3: Update hireFromUi handler to pass adapterName**

Find the agents:hire-from-ui IPC handler in `apps/main/src/ipc/orchestrator-handlers.ts` (or wherever it lives — `grep AGENTS_HIRE_FROM_UI` to locate). It calls `agents.create({...})`. Before that call, read the current authMode and pass adapterName:

```typescript
import { createSettingsRepository } from "../settings/repository.js";
// …
const authMode = createSettingsRepository(db).read().authMode;
const adapterName = authMode === "api-key" ? "claude-api-key-local" : "claude-oauth-local";
agents.create({ ...input, adapterName });
```

Do the same in any other place that calls `agents.create` for user-driven creation (search for `agents.create(` and `agentsRepo.create(`). Seed code (`agents/seed.ts`) can stay on the default — demo companies use OAuth.

- [ ] **Step 10.4: Commit**

```bash
git add apps/main/src/agents/repository.ts apps/main/src/agents/repository.test.ts apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(m9): agents.create accepts adapterName, hire pipeline reads authMode"
```

---

## Task 11: orchestrator-handlers ensureAgentRunner honors authMode

**Files:**
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

- [ ] **Step 11.1: Update ensureAgentRunner**

In `apps/main/src/ipc/orchestrator-handlers.ts`, find `ensureAgentRunner` (around line 238). Replace the OAuth-only block:

```typescript
    const token = loadDecryptedToken(db);
    if (token === null) throw new Error("OAuth token not configured");
```

with:

```typescript
    const adapterName = (agent.adapterName as string | undefined) ?? "claude-oauth-local";
    let oauthToken: string | undefined;
    let apiKey: string | undefined;
    if (adapterName === "claude-oauth-local") {
      const t = loadDecryptedToken(db);
      if (t === null) throw new Error("OAuth token not configured");
      oauthToken = t;
    } else if (adapterName === "claude-api-key-local") {
      const { loadDecryptedApiKey } = await import("../auth/api-key-storage.js");
      const k = loadDecryptedApiKey(db);
      if (k === null) throw new Error("API key not configured");
      apiKey = k;
    } else {
      throw new Error(`Unknown adapter '${adapterName}'`);
    }
```

> **Why dynamic import:** `api-key-storage.ts` imports `electron.safeStorage` which is mocked in tests. Static top-level import would pull `electron` into every consumer at parse time. Existing pattern in the file likely already does this — check before adding.
>
> Actually, look at the file head: `loadDecryptedToken` is statically imported. Match that style — add a static import for `loadDecryptedApiKey` at the top of the file instead:
>
> `import { loadDecryptedApiKey } from "../auth/api-key-storage.js";`
>
> Then use `loadDecryptedApiKey(db)` directly without the dynamic import.

Find the `void ensureAdapter({ … })` call below it. Replace the `oauthToken: token,` line with:

```typescript
        ...(oauthToken !== undefined ? { oauthToken } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
```

- [ ] **Step 11.2: Typecheck + commit**

```bash
pnpm --filter @prospero/main typecheck
pnpm --filter @prospero/main test
git add apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(m9): ensureAgentRunner picks credentials based on agent adapter_name"
```

---

## Task 12: Preload bridge + env.d.ts

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 12.1: Preload — extend auth block**

Edit `apps/main/src/ipc/preload.ts`. Find the `auth:` block (around line 51-59). Replace with:

```typescript
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_STATUS) as Promise<TokenStatus>,
    set: (raw: string, source: TokenSource) =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_SET, { raw, source }) as Promise<TokenStatus>,
    detect: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_DETECT) as Promise<DetectResult>,
    importDetected: () =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_IMPORT_DETECTED) as Promise<TokenStatus>,
    clear: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_CLEAR) as Promise<TokenStatus>,
    apiKeyStatus: () => ipcRenderer.invoke(IPC.AUTH_API_KEY_STATUS) as Promise<ApiKeyStatus>,
    apiKeySet: (raw: string) =>
      ipcRenderer.invoke(IPC.AUTH_API_KEY_SET, { raw }) as Promise<ApiKeyStatus>,
    apiKeyClear: () => ipcRenderer.invoke(IPC.AUTH_API_KEY_CLEAR) as Promise<ApiKeyStatus>,
  },
```

Add `type ApiKeyStatus` to the top-of-file import block.

- [ ] **Step 12.2: env.d.ts**

Edit `apps/renderer/src/env.d.ts`. Add `ApiKeyStatus` to the type imports, then extend `auth`:

```typescript
auth: {
  status: () => Promise<TokenStatus>;
  set: (raw: string, source: TokenSource) => Promise<TokenStatus>;
  detect: () => Promise<DetectResult>;
  importDetected: () => Promise<TokenStatus>;
  clear: () => Promise<TokenStatus>;
  apiKeyStatus: () => Promise<ApiKeyStatus>;
  apiKeySet: (raw: string) => Promise<ApiKeyStatus>;
  apiKeyClear: () => Promise<ApiKeyStatus>;
};
```

- [ ] **Step 12.3: Typecheck + commit**

```bash
pnpm -r typecheck
git add apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m9): preload bridge exposes auth.apiKey{Status,Set,Clear}"
```

---

## Task 13: Renderer stores — auth.apiKey + settings.setAuthMode

**Files:**
- Modify: `apps/renderer/src/stores/auth.ts`
- Modify: `apps/renderer/src/stores/settings.ts`

- [ ] **Step 13.1: Read existing auth store**

```bash
cat "apps/renderer/src/stores/auth.ts"
```

Note its current shape (status, setToken, importDetected). We'll extend.

- [ ] **Step 13.2: Extend auth store**

Edit `apps/renderer/src/stores/auth.ts`. Add fields to State:

```typescript
import type { ApiKeyStatus } from "@prospero/shared";
// …
type State = {
  // …existing
  apiKeyStatus: ApiKeyStatus;
  setApiKey: (raw: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
};
```

In the create() body, add initial state and impl:

```typescript
apiKeyStatus: { hasKey: false } as ApiKeyStatus,
// …
setApiKey: async (raw) => {
  const status = await window.prospero.auth.apiKeySet(raw);
  set({ apiKeyStatus: status });
},
clearApiKey: async () => {
  const status = await window.prospero.auth.apiKeyClear();
  set({ apiKeyStatus: status });
},
```

Update the existing `load()` (or `init()`) action — wherever it fetches `auth.status()` — to also fetch `auth.apiKeyStatus()` and store:

```typescript
const [status, apiKeyStatus] = await Promise.all([
  window.prospero.auth.status(),
  window.prospero.auth.apiKeyStatus(),
]);
set({ status, apiKeyStatus, loaded: true });
```

- [ ] **Step 13.3: Extend settings store**

Edit `apps/renderer/src/stores/settings.ts`. Add to State:

```typescript
setAuthMode: (mode: "oauth" | "api-key") => Promise<void>;
```

Inside the factory, after `setModel`:

```typescript
setAuthMode: async (mode) => {
  const next = await window.prospero.settings.update({ authMode: mode });
  set({ settings: next });
},
```

- [ ] **Step 13.4: Typecheck + commit**

```bash
pnpm --filter @prospero/renderer typecheck
git add apps/renderer/src/stores/auth.ts apps/renderer/src/stores/settings.ts
git commit -m "feat(m9): renderer auth store handles api key + settings setAuthMode"
```

---

## Task 14: Settings.tsx — Authentication section

**Files:**
- Modify: `apps/renderer/src/routes/Settings.tsx`

- [ ] **Step 14.1: Locate insertion point**

Read `apps/renderer/src/routes/Settings.tsx`. Find the existing section blocks (theme, language, executor, etc.). Pick a stable insertion point — e.g. after the OAuth token section (search for `auth.status` references).

- [ ] **Step 14.2: Add the Auth mode section**

Insert this JSX block at the chosen location:

```tsx
<section className="mb-6">
  <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft mb-2">
    {t("settings.auth.mode.title")}
  </h2>
  <p className="text-xs text-ink-muted mb-3">{t("settings.auth.mode.subtitle")}</p>
  <div className="space-y-2">
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="radio"
        name="authMode"
        value="oauth"
        checked={settings.authMode === "oauth"}
        onChange={() => void setAuthMode("oauth")}
        className="mt-1"
      />
      <div>
        <div className="text-sm font-medium">{t("settings.auth.mode.oauth.label")}</div>
        <div className="text-xs text-ink-muted">{t("settings.auth.mode.oauth.desc")}</div>
      </div>
    </label>
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="radio"
        name="authMode"
        value="api-key"
        checked={settings.authMode === "api-key"}
        onChange={() => void setAuthMode("api-key")}
        className="mt-1"
      />
      <div>
        <div className="text-sm font-medium">{t("settings.auth.mode.apiKey.label")}</div>
        <div className="text-xs text-ink-muted">{t("settings.auth.mode.apiKey.desc")}</div>
      </div>
    </label>
  </div>

  {settings.authMode === "api-key" && (
    <div className="mt-4 pl-6 border-l-2 border-surface-border">
      {apiKeyStatus.hasKey ? (
        <div className="space-y-2">
          <code className="block text-xs bg-surface-soft p-2 rounded">
            {apiKeyStatus.maskedPrefix}
          </code>
          <button
            type="button"
            onClick={() => void clearApiKey()}
            className="text-xs text-semantic-danger hover:underline"
          >
            {t("settings.auth.apiKey.clear")}
          </button>
        </div>
      ) : (
        <ApiKeyInlineForm />
      )}
    </div>
  )}
</section>
```

And add this `ApiKeyInlineForm` component at the bottom of the file (or at top, as preferred):

```tsx
const ApiKeyInlineForm = () => {
  const { t } = useTranslation();
  const setApiKey = useAuthStore((s) => s.setApiKey);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await setApiKey(value);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("settings.auth.apiKey.placeholder")}
        disabled={busy}
        className="w-full px-3 py-2 text-xs font-mono bg-surface-soft border border-surface-border rounded"
      />
      {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || value.length === 0}
        className="px-3 py-1 text-xs font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
      >
        {busy ? t("settings.auth.apiKey.saving") : t("settings.auth.apiKey.save")}
      </button>
    </div>
  );
};
```

Bind selectors near the existing ones at the top of `Settings` function:

```tsx
const setAuthMode = useSettingsStore((s) => s.setAuthMode);
const apiKeyStatus = useAuthStore((s) => s.apiKeyStatus);
const clearApiKey = useAuthStore((s) => s.clearApiKey);
```

Don't forget the imports at top: `useState`, `useAuthStore`, `useSettingsStore`.

- [ ] **Step 14.3: Typecheck + commit**

```bash
pnpm --filter @prospero/renderer typecheck
git add apps/renderer/src/routes/Settings.tsx
git commit -m "feat(m9): settings authentication section — mode radio + api key inline form"
```

---

## Task 15: SetupWizard — auth source + API key steps

**Files:**
- Modify: `apps/renderer/src/routes/SetupWizard.tsx`

- [ ] **Step 15.1: Extend Step union + initial state**

Edit `apps/renderer/src/routes/SetupWizard.tsx`. Change line 6:

```typescript
type Step = "authSource" | "choose" | "manual" | "auto" | "apiKey";
```

Change line 13:

```typescript
const [step, setStep] = useState<Step>("authSource");
```

Add fields for api-key flow:

```typescript
const setApiKey = useAuthStore((s) => s.setApiKey);
const setAuthMode = useSettingsStore((s) => s.setAuthMode);
const [apiKeyInput, setApiKeyInput] = useState("");
```

Import `useSettingsStore` at top.

- [ ] **Step 15.2: Add the authSource step UI**

Before the `step === "choose"` block, insert:

```tsx
{step === "authSource" && (
  <div className="space-y-3">
    <p className="text-sm text-ink font-medium">{t("wizard.authSource.title")}</p>
    <p className="text-xs text-ink-muted">{t("wizard.authSource.subtitle")}</p>
    <button
      onClick={() => void setAuthMode("oauth").then(() => setStep("choose"))}
      className="w-full text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
      type="button"
    >
      <div className="text-sm font-semibold text-ink">{t("wizard.authSource.oauth.title")}</div>
      <div className="text-xs text-ink-muted mt-1">{t("wizard.authSource.oauth.desc")}</div>
    </button>
    <button
      onClick={() => void setAuthMode("api-key").then(() => setStep("apiKey"))}
      className="w-full text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
      type="button"
    >
      <div className="text-sm font-semibold text-ink">{t("wizard.authSource.apiKey.title")}</div>
      <div className="text-xs text-ink-muted mt-1">{t("wizard.authSource.apiKey.desc")}</div>
    </button>
  </div>
)}
```

- [ ] **Step 15.3: Add the apiKey step UI**

After the `step === "auto"` block, append:

```tsx
{step === "apiKey" && (
  <div className="space-y-3">
    <h3 className="text-sm font-semibold text-brand-dark">
      {t("wizard.apiKey.title")}
    </h3>
    <p className="text-xs text-ink-muted">{t("wizard.apiKey.subtitle")}</p>
    <input
      type="password"
      autoComplete="off"
      spellCheck={false}
      value={apiKeyInput}
      onChange={(e) => setApiKeyInput(e.target.value)}
      placeholder={t("wizard.apiKey.placeholder")}
      className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono mt-3"
    />
    {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
    <div className="flex gap-2 pt-2">
      <button
        onClick={() => setStep("authSource")}
        className="px-4 py-2 text-sm text-ink hover:bg-surface-soft rounded"
        type="button"
      >
        {t("wizard.back")}
      </button>
      <button
        onClick={async () => {
          setError(null);
          try {
            await setApiKey(apiKeyInput);
            navigate("/dashboard");
          } catch (err) {
            setError(err instanceof Error ? err.message : t("settings.auth.tokenInvalid"));
          }
        }}
        disabled={apiKeyInput.length === 0}
        className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
        type="button"
      >
        {t("wizard.apiKey.save")}
      </button>
    </div>
  </div>
)}
```

Also update the back-button on `manual` and `auto` steps to go to `"authSource"` instead of `"choose"`, OR keep `"choose"` and add a Back arrow on `"choose"` returning to `"authSource"`. The simplest: keep `"choose"` back-buttons as-is, since "choose" → "authSource" can be triggered by a small chevron.

Actually for clarity, change the Back buttons in `manual` and `auto` from `setStep("choose")` to `setStep("authSource")`. Easier than adding navigation chrome.

- [ ] **Step 15.4: Typecheck + commit**

```bash
pnpm --filter @prospero/renderer typecheck
git add apps/renderer/src/routes/SetupWizard.tsx
git commit -m "feat(m9): setup wizard auth source step + api key step"
```

---

## Task 16: i18n keys + parity test

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 16.1: Add PT-BR keys**

In `apps/renderer/src/i18n/pt-BR.json`, add nested keys (find a sensible insertion point, near `settings` or top-level):

```json
"wizard": {
  "authSource": {
    "title": "Como você quer autenticar?",
    "subtitle": "Você pode trocar depois em Configurações.",
    "oauth": {
      "title": "OAuth Max (recomendado)",
      "desc": "Usa sua assinatura Claude Max — flat rate, sem cobrança por token. Limite: 4 agentes simultâneos."
    },
    "apiKey": {
      "title": "API key",
      "desc": "Cobra por token via Anthropic API. Sem limite de 4 agentes — só rate limit da conta."
    }
  },
  "apiKey": {
    "title": "Configurar API key",
    "subtitle": "Cole sua chave Anthropic (começa com sk-ant-api…). Ela é criptografada com safeStorage e nunca sai do seu computador.",
    "placeholder": "sk-ant-api03-…",
    "save": "Salvar e continuar"
  }
}
```

> If `wizard` already has a top-level key (it does — see line ~10 of pt-BR.json), append these sub-keys inside the existing block instead of creating a duplicate.

Add the `settings.auth.*` keys:

```json
"settings": {
  // …existing
  "auth": {
    "mode": {
      "title": "Autenticação",
      "subtitle": "OAuth Max usa sua assinatura · API key cobra por token. Você pode trocar a qualquer momento.",
      "oauth": {
        "label": "OAuth Max (recomendado)",
        "desc": "Flat rate · limite 4 agentes simultâneos (ToS Anthropic)"
      },
      "apiKey": {
        "label": "API key",
        "desc": "Cobra por token · sem limite de 4 agentes"
      }
    },
    "apiKey": {
      "placeholder": "sk-ant-api03-…",
      "save": "Salvar",
      "saving": "Salvando…",
      "clear": "Remover chave"
    }
  }
}
```

- [ ] **Step 16.2: Mirror in EN-US**

Add the same keys to `apps/renderer/src/i18n/en-US.json`:

```json
"wizard": {
  "authSource": {
    "title": "How do you want to authenticate?",
    "subtitle": "You can switch later in Settings.",
    "oauth": {
      "title": "OAuth Max (recommended)",
      "desc": "Uses your Claude Max subscription — flat rate, no per-token billing. Cap: 4 concurrent agents."
    },
    "apiKey": {
      "title": "API key",
      "desc": "Billed per token via Anthropic API. No 4-agent cap — only your account rate limit."
    }
  },
  "apiKey": {
    "title": "Configure API key",
    "subtitle": "Paste your Anthropic key (starts with sk-ant-api…). It's encrypted with safeStorage and never leaves your machine.",
    "placeholder": "sk-ant-api03-…",
    "save": "Save and continue"
  }
}
```

And settings.auth.* mirror:

```json
"auth": {
  "mode": {
    "title": "Authentication",
    "subtitle": "OAuth Max uses your subscription · API key bills per token. Switch any time.",
    "oauth": {
      "label": "OAuth Max (recommended)",
      "desc": "Flat rate · 4-agent concurrent cap (Anthropic ToS)"
    },
    "apiKey": {
      "label": "API key",
      "desc": "Per-token billing · no 4-agent cap"
    }
  },
  "apiKey": {
    "placeholder": "sk-ant-api03-…",
    "save": "Save",
    "saving": "Saving…",
    "clear": "Remove key"
  }
}
```

- [ ] **Step 16.3: Extend parity assertions**

Edit `apps/renderer/src/i18n/parity.test.ts`. Add a new `it()` block before the existing "narrated keys" one:

```typescript
it("includes the M9 PR-D api-key keys in both locales", () => {
  const ptKeys = flatten(ptBR);
  const enKeys = flatten(enUS);
  for (const k of [
    "wizard.authSource.title",
    "wizard.authSource.oauth.title",
    "wizard.authSource.apiKey.title",
    "wizard.apiKey.title",
    "wizard.apiKey.placeholder",
    "wizard.apiKey.save",
    "settings.auth.mode.title",
    "settings.auth.mode.oauth.label",
    "settings.auth.mode.apiKey.label",
    "settings.auth.apiKey.placeholder",
    "settings.auth.apiKey.save",
    "settings.auth.apiKey.clear",
  ]) {
    expect(ptKeys).toContain(k);
    expect(enKeys).toContain(k);
  }
});
```

Run: `pnpm --filter @prospero/renderer test -- parity`. Expected PASS (both bidirectional + new).

- [ ] **Step 16.4: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m9): i18n keys for setup wizard auth source + settings auth (pt-BR + en-US)"
```

---

## Task 17: SECURITY.md update

**Files:**
- Modify: `SECURITY.md`

- [ ] **Step 17.1: Add Auth modes section**

Find an appropriate place in `SECURITY.md` (likely after the existing "Architectural decisions" or "Adapter threat models" section). Append:

```markdown
## Auth modes (M9 PR-D)

The desktop app supports two authentication modes, persisted in `AppSettings.authMode`:

### `oauth` (default, recommended)

- Uses your Claude Max subscription via OAuth token, identical to behavior up through M8.6.
- Token stored encrypted in `safeStorage` (DB `settings` table, key `auth.token.ciphertext`).
- Adapter: `claude-oauth-local` — seeds `<CLAUDE_CONFIG_DIR>/.credentials.json` per spawn from host keychain.
- Threat model unchanged from M7.5 — see "Adapter threat models" above.
- **Hard cap: 4 concurrent agents** per Anthropic OAuth Max ToS.

### `api-key` (M9 PR-D)

- Uses a raw Anthropic API key (`sk-ant-api…`) — billed per token by Anthropic.
- Key stored encrypted in `safeStorage` (DB `settings` table, key `auth.apikey.ciphertext`).
- Adapter: `claude-api-key-local` — passes `ANTHROPIC_API_KEY` env var on spawn. Does **not** seed `.credentials.json`. `--strict-mcp-config` remains active.
- The renderer never sees the raw key — only the masked prefix (`sk-ant-api03-…XXXX`).
- IPC handlers: `auth:api-key-set` (validates regex + encrypts + persists), `auth:api-key-status` (returns `{hasKey, maskedPrefix}`), `auth:api-key-clear`.
- **No 4-agent cap** — rate limiting is enforced by Anthropic's API gateway on the user's account.

### Switching modes

Switching `authMode` in Settings takes effect for **new agents only**. Existing agents keep their `adapter_name` (set at creation) until terminated and re-spawned. This avoids mid-turn credential swaps.

Both blobs (`auth.token.ciphertext` and `auth.apikey.ciphertext`) coexist independently — switching mode does not delete the other credential. This lets a user move back and forth without re-pasting.
```

- [ ] **Step 17.2: Commit**

```bash
git add SECURITY.md
git commit -m "docs(m9): SECURITY.md — auth modes (oauth + api-key) threat models"
```

---

## Task 18: Full suite verification

- [ ] **Step 18.1: Run everything**

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

All must pass. Tests count: 731 + ~25 new (T1: 3, T2: 5, T3: 6, T4: 3, T5: 1, T6: 2, T8: 4, T10: 2, T16: 1 parity) = **~756**.

- [ ] **Step 18.2: If a test fails, investigate**

Common causes:
- `agents.create` call without `adapterName` in some forgotten path → defaults to oauth (fine).
- Renderer tests reading `auth.apiKeyStatus` from a store that hasn't been initialized → mock in `beforeEach`.
- i18n parity bidirectional check fails if PT-BR has key EN-US doesn't (or vice versa).

Fix inline before continuing.

---

## Task 19: Roadmap update (3 lugares)

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/roadmap.html`

- [ ] **Step 19.1: ROADMAP.md §M9 checkboxes**

Find the API key section (~line 753-761 of ROADMAP.md). Check off:

```diff
- [ ] **Suporte a API key (2º adapter `claude-api-key-local`)** — dual auth via adapter pattern do M7.5:
+ [x] **Suporte a API key (2º adapter `claude-api-key-local`)** ✅ **PR-D mergeado 2026-05-14** — dual auth via adapter pattern do M7.5:
  - [x] Setup wizard: pergunta auth source (OAuth Max recomendado / API key)
  - [x] Settings: switch entre OAuth Max e API key (com warning sobre custo)
  - [x] `auth-mode.ts` agora retorna `'oauth' | 'api-key'` baseado em settings
  - [x] Storage: `safeStorage.encrypt(apiKey)` + 3 IPCs (`auth:api-key-{set,status,clear}`)
  - [x] Novo adapter impl `claude-api-key-local` em `apps/main/src/orchestrator/adapters/`
  - [x] Limite dos 4 agentes: aplicar SÓ pra OAuth Max (lifecycle.ts guard)
  - [x] Documentar em SECURITY.md as 2 modes + trade-offs
```

- [ ] **Step 19.2: v1 scope tracker row**

Find a `🟡` row mentioning M9 API key (if exists) and flip to ✅. If no dedicated row, add a brief mention under "Authentication" or "Settings". Search the doc for `API key` first.

- [ ] **Step 19.3: roadmap.html 3 sections**

Edit `docs/roadmap.html`:

1. `/00 layperson` — find the "Por baixo do capô" or "Personalização" cards. Add a note "**API key suportada** como alternativa ao OAuth Max (M9 PR-D)".
2. `/01 progress` — bump test count to ~756, update the "agora" card stage to "M9 PR-D mergeado", list remaining PRs (B/C/E/F).
3. `/03 módulos` — in the M9 article, mark the "API key (2º adapter)" feature group with ✅ and the PR-D date.

- [ ] **Step 19.4: Commit**

```bash
git add ROADMAP.md docs/roadmap.html
git commit -m "docs(m9): close pr-d api-key adapter in roadmap (3 places)"
```

---

## Task 20: Memory snippet + handoff

**Files:**
- Create: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-Prospero\memory\project_m9_pr_d_lessons.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-Prospero\memory\MEMORY.md`
- Modify: `C:\Users\hever\.claude\projects\D--Projetos-pessoais-Prospero\memory\project_session_handoff.md`

- [ ] **Step 20.1: Write lessons memory**

Content sketch:

```markdown
---
name: project-m9-pr-d-lessons
description: "M9 PR-D api-key adapter mergeado 2026-05-14. ~20 commits, ~25 testes novos, ~756 total. claude-api-key-local adapter (env-based credentials, no seeding) + safeStorage + IPCs + Settings UI + Setup wizard step. Lições: SpawnContext optional credentials, dynamic import gotcha em testes que mockam electron, adapter_name é seed-time não runtime."
metadata:
  type: project
---

# M9 PR-D — API key adapter (mergeado 2026-05-14)

## Decisões
- `adapter_name` é set at agent **create time**, não dinâmico. Mudar authMode em Settings só afeta novos agents.
- Ambos os blobs (OAuth + API key) coexistem em safeStorage. Switching mode não apaga o outro.
- SpawnContext ganhou `oauthToken?: string` + `apiKey?: string` opcionais. Cada adapter valida o que precisa em `start()`.
- 4-agent cap migrou de `MAX_CONCURRENT_AGENTS >=` para conditional em `agent.adapterName === 'claude-oauth-local'`.

## Lições
1. **`getActiveAuthMode()` mudou assinatura** — antes era stub `() => 'oauth'`, agora `(db) => 'oauth' | 'api-key'`. Quebra chamadores; só lifecycle.ts era consumidor real. Limpei o fallback branch.
2. **safeStorage mock pattern** — `vi.mock('electron', () => ({safeStorage: {...}}))` precisa retornar `encryptString`/`decryptString` consistentes (round-trip). Padrão herdado do `token-storage` test.
3. **Adapter dir duplication** — copiei toda a estrutura `claude-oauth-local/adapter.ts` em vez de factor out compartilhado. Justificativa: factor-out vira refactor de M10. Imports cruzados (`../claude-oauth-local/build-args.js`) funcionam mas são deliberadamente feios pra sinalizar dívida.
4. **3 IPCs API key** seguem padrão token: status sync, set async (Promise.resolve.then pra capturar throw), clear sync. Renderer auth store espelha o pattern.

## Próximo
PR-B — Dashboard widgets (6 widgets + Recent Activity). Spec §6.
```

- [ ] **Step 20.2: Update MEMORY.md index**

Add line after the PR-A lessons entry:

```markdown
- [M9 PR-D lições — API key adapter](project_m9_pr_d_lessons.md) — mergeado 2026-05-14, claude-api-key-local + safeStorage + IPCs + Settings + Setup wizard. SpawnContext opcional, adapter_name é seed-time.
```

- [ ] **Step 20.3: Update session_handoff**

Bump HEAD, test count, milestones-completed line ("2/6 PRs do M9" agora), and "próximo" to PR-B.

---

## Self-review checklist

- [x] **Spec coverage:** every PR-D bullet from `2026-05-14-m9-design.md` §5 maps to a task — adapter (T6/T7), env (T5), safeStorage (T3), validate (T2), IPCs (T8), 4-agent cap (T9), agents.create.adapter_name (T10), ensureAgentRunner (T11), Settings UI (T14), Setup wizard (T15), SECURITY.md (T17), i18n (T16).
- [x] **Placeholder scan:** every step contains actual code or commands. No "TBD". The `it.todo` markers in T9 are intentional — they document untested integration behavior, not promised tests.
- [x] **Type consistency:** `ApiKeyStatus`, `AuthMode`, `apiKeyStatus` (renderer state field), `apiKeyStatus` (IPC method name) all consistent. `setApiKey(raw)` signature consistent across store + preload.
- [x] **Migration:** no DDL change. `authMode` is a settings JSON field; `adapter_name` column already exists from M7.5 (0004).

If during execution something diverges, fix inline and append a note in T20's lessons memory.
