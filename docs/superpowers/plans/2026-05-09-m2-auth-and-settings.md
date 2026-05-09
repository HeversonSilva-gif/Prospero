# M2 — Auth & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OAuth token storage (Electron `safeStorage` for DPAPI on Windows), Settings page, theme switcher (light/dark), language switcher (pt-BR/en-US) and first-run setup wizard. After M2 the user can paste/auto-detect the Claude OAuth token and switch theme/language without reload — persisted in SQLite.

**Architecture:** All token bytes stay in the main process; the renderer only sees a redacted view (`hasToken`, `expiresInDays`). Settings (theme, language, paths) are cached in a Zustand store with IPC sync against the SQLite `settings` table. i18n via `react-i18next`, theme via Tailwind `darkMode: "class"` driven by a `<html class="dark">` toggle. First-run experience routes the user to a wizard until a token is configured.

**Tech Stack:** Electron `safeStorage`, better-sqlite3 (existing), Zod, react-i18next 15, Zustand 4, react-router-dom 6 (basic), Vitest (existing), better-sqlite3 (existing).

**Spec reference:** `docs/superpowers/specs/2026-05-09-dashboard-agent-design.md` (§5.3 settings table; §8.1 credentials encryption; §6.3 i18n; §6.2 theme palette).

**Spec compliance hooks:**
- §8.1 — DPAPI encryption: implemented via Electron `safeStorage` (uses DPAPI on Windows, Keychain on Mac, libsecret on Linux)
- §8.1 — token never logged: redact filter in main-process logger; renderer never receives the raw token
- §9 — token cache TTL is irrelevant in M2 (no cache yet); but the IPC for `getMaskedToken()` is the only renderer-facing accessor
- §10.2 — adds 1 security test: token in raw form must never appear in any IPC payload returning to the renderer

---

## Pre-flight

- M1 is complete; the repo has Electron + SQLite + IPC + 23 commits, latest `1f6afc7`.
- pnpm 9.12.0, Node 20, gitleaks installed, husky hooks active.
- Verify: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes.

---

## File Structure (this milestone)

```
apps/main/src/
├── auth/
│   ├── token-storage.ts        # safeStorage encrypt + SQLite persist
│   ├── token-detect.ts         # ~/.claude/.credentials.json reader
│   ├── token-validate.ts       # format check
│   └── token-redact.ts         # log filter
├── settings/
│   ├── repository.ts           # SQLite CRUD on settings table
│   └── schema.ts               # Zod schema for typed settings
├── ipc/
│   ├── handlers.ts             # MODIFIED: dispatch to settings/auth handlers
│   ├── settings-handlers.ts    # get/set settings IPC
│   ├── auth-handlers.ts        # token IPC (set, status, detect, clear)
│   └── preload.ts              # MODIFIED: expose settings/auth APIs
└── tests/
    ├── auth.token-storage.test.ts
    ├── auth.token-validate.test.ts
    ├── auth.token-redact.test.ts
    ├── settings.repository.test.ts
    └── settings.schema.test.ts

apps/renderer/src/
├── routes/
│   ├── Dashboard.tsx           # placeholder (real Dashboard in M6)
│   ├── Settings.tsx            # full settings page
│   └── SetupWizard.tsx         # first-run flow
├── components/
│   ├── ThemeToggle.tsx
│   ├── LanguageToggle.tsx
│   ├── SidebarFooter.tsx
│   └── Sidebar.tsx             # minimal shell with footer
├── i18n/
│   ├── index.ts
│   ├── pt-BR.json
│   └── en-US.json
├── theme/
│   ├── tokens.css              # CSS variables for light/dark
│   └── ThemeProvider.tsx
├── stores/
│   └── settings.ts             # Zustand store + IPC sync
├── App.tsx                     # MODIFIED: routing + first-run gate
├── main.tsx                    # MODIFIED: i18n init + theme apply
├── env.d.ts                    # MODIFIED: extended dashboardAgent API
└── styles/index.css            # MODIFIED: import theme tokens

packages/shared/src/
├── ipc-channels.ts             # MODIFIED: settings + auth channels
└── types/
    ├── settings.ts             # NEW: AppSettings type
    └── auth.ts                 # NEW: TokenStatus, TokenSource
```

Each file has one clear responsibility. Files that change with settings live together (`settings/`); auth logic lives together (`auth/`).

---

## Task 1: Settings types + IPC channels (shared)

**Files:**
- Create: `packages/shared/src/types/settings.ts`
- Create: `packages/shared/src/types/auth.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `packages/shared/tests/settings.test.ts`

- [ ] **Step 1: Write failing test for settings types and channels**

`packages/shared/tests/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IPC, type AppSettings, type TokenStatus, type TokenSource } from "../src/index.js";

describe("settings types and channels", () => {
  it("defines settings IPC channels", () => {
    expect(IPC.SETTINGS_GET).toBe("settings:get");
    expect(IPC.SETTINGS_UPDATE).toBe("settings:update");
  });

  it("defines auth IPC channels", () => {
    expect(IPC.AUTH_TOKEN_STATUS).toBe("auth:token-status");
    expect(IPC.AUTH_TOKEN_SET).toBe("auth:token-set");
    expect(IPC.AUTH_TOKEN_DETECT).toBe("auth:token-detect");
    expect(IPC.AUTH_TOKEN_CLEAR).toBe("auth:token-clear");
  });

  it("AppSettings is structurally constructable", () => {
    const s: AppSettings = { language: "pt-BR", theme: "light" };
    expect(s.language).toBe("pt-BR");
    expect(s.theme).toBe("light");
  });

  it("TokenStatus reflects empty state", () => {
    const s: TokenStatus = { hasToken: false };
    expect(s.hasToken).toBe(false);
  });

  it("TokenSource enumerates manual + auto-detect", () => {
    const a: TokenSource = "manual";
    const b: TokenSource = "auto-detect";
    expect(a).toBe("manual");
    expect(b).toBe("auto-detect");
  });
});
```

- [ ] **Step 2: Verify red**

```powershell
pnpm --filter @dashboard-agent/shared test
```

Expected: FAIL — types/channels missing.

- [ ] **Step 3: Implement `packages/shared/src/types/settings.ts`**

```ts
export type Language = "pt-BR" | "en-US";
export type Theme = "light" | "dark";

export type AppSettings = {
  language: Language;
  theme: Theme;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
};
```

- [ ] **Step 4: Implement `packages/shared/src/types/auth.ts`**

```ts
export type TokenSource = "manual" | "auto-detect";

export type TokenStatus =
  | { hasToken: false }
  | {
      hasToken: true;
      source: TokenSource;
      maskedPrefix: string;       // e.g. "sk-ant-oat-..." (first 12 chars + "...")
      configuredAt: number;       // unix ms
    };
```

- [ ] **Step 5: Update `packages/shared/src/types/index.ts`**

```ts
export * from "./ids.js";
export * from "./settings.js";
export * from "./auth.js";
```

- [ ] **Step 6: Update `packages/shared/src/ipc-channels.ts`**

```ts
export const IPC = {
  PING: "ping",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  AUTH_TOKEN_STATUS: "auth:token-status",
  AUTH_TOKEN_SET: "auth:token-set",
  AUTH_TOKEN_DETECT: "auth:token-detect",
  AUTH_TOKEN_CLEAR: "auth:token-clear",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
```

- [ ] **Step 7: Verify green**

```powershell
pnpm --filter @dashboard-agent/shared test
pnpm --filter @dashboard-agent/shared typecheck
```

Expected: 5 + 3 (existing) = 8 tests pass; typecheck clean.

- [ ] **Step 8: Commit**

```powershell
git add packages/shared
git commit -m "feat(shared): add settings + auth types and ipc channels"
```

---

## Task 2: Settings schema (Zod)

**Files:**
- Create: `apps/main/src/settings/schema.ts`
- Create: `apps/main/tests/settings.schema.test.ts`
- Modify: `apps/main/package.json` (add `zod`)

- [ ] **Step 1: Add `zod` dependency**

```powershell
pnpm --filter @dashboard-agent/main add zod@^3.23.8
```

- [ ] **Step 2: Write failing test**

`apps/main/tests/settings.schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppSettingsSchema, parseSettings } from "../src/settings/schema.js";

describe("settings schema", () => {
  it("accepts valid settings", () => {
    const parsed = AppSettingsSchema.parse({ language: "pt-BR", theme: "light" });
    expect(parsed.language).toBe("pt-BR");
    expect(parsed.theme).toBe("light");
  });

  it("rejects invalid language", () => {
    expect(() => AppSettingsSchema.parse({ language: "fr-FR", theme: "light" })).toThrow();
  });

  it("rejects invalid theme", () => {
    expect(() => AppSettingsSchema.parse({ language: "pt-BR", theme: "neon" })).toThrow();
  });

  it("parseSettings fills defaults for missing fields", () => {
    expect(parseSettings({})).toEqual({ language: "pt-BR", theme: "light" });
  });

  it("parseSettings preserves valid partial input", () => {
    expect(parseSettings({ theme: "dark" })).toEqual({ language: "pt-BR", theme: "dark" });
  });

  it("parseSettings drops unknown keys", () => {
    expect(parseSettings({ language: "en-US", garbage: "ignored" })).toEqual({
      language: "en-US",
      theme: "light",
    });
  });
});
```

- [ ] **Step 3: Verify red**

```powershell
pnpm --filter @dashboard-agent/main test
```

Expected: 6 new failures (module missing).

- [ ] **Step 4: Implement `apps/main/src/settings/schema.ts`**

```ts
import { z } from "zod";
import { DEFAULT_SETTINGS, type AppSettings } from "@dashboard-agent/shared";

export const AppSettingsSchema = z.object({
  language: z.enum(["pt-BR", "en-US"]),
  theme: z.enum(["light", "dark"]),
});

const PartialAppSettingsSchema = AppSettingsSchema.partial();

export const parseSettings = (raw: unknown): AppSettings => {
  const result = PartialAppSettingsSchema.safeParse(raw);
  if (!result.success) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...result.data };
};
```

- [ ] **Step 5: Verify green**

```powershell
pnpm --filter @dashboard-agent/main test
```

Expected: 6 new tests pass + 6 pre-existing = 12 passing.

- [ ] **Step 6: Commit**

```powershell
git add apps/main pnpm-lock.yaml
git commit -m "feat(settings): add zod schema for app settings with defaults"
```

---

## Task 3: Settings repository (SQLite CRUD)

**Files:**
- Create: `apps/main/src/settings/repository.ts`
- Create: `apps/main/tests/settings.repository.test.ts`

- [ ] **Step 1: Write failing test**

`apps/main/tests/settings.repository.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createSettingsRepository } from "../src/settings/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return { db, repo: createSettingsRepository(db) };
};

describe("settings repository", () => {
  it("returns defaults on empty db", () => {
    const { repo } = setup();
    expect(repo.read()).toEqual({ language: "pt-BR", theme: "light" });
  });

  it("persists a single field via write()", () => {
    const { repo } = setup();
    repo.write({ theme: "dark" });
    expect(repo.read()).toEqual({ language: "pt-BR", theme: "dark" });
  });

  it("persists multiple fields", () => {
    const { repo } = setup();
    repo.write({ language: "en-US", theme: "dark" });
    expect(repo.read()).toEqual({ language: "en-US", theme: "dark" });
  });

  it("ignores invalid values silently", () => {
    const { repo } = setup();
    repo.write({ theme: "neon" } as never);
    expect(repo.read().theme).toBe("light");
  });

  it("reads survive across re-instantiations on the same db", () => {
    const { db, repo } = setup();
    repo.write({ language: "en-US" });
    const repo2 = createSettingsRepository(db);
    expect(repo2.read().language).toBe("en-US");
  });
});
```

- [ ] **Step 2: Verify red**

- [ ] **Step 3: Implement `apps/main/src/settings/repository.ts`**

```ts
import type Database from "better-sqlite3";
import { DEFAULT_SETTINGS, type AppSettings } from "@dashboard-agent/shared";
import { AppSettingsSchema } from "./schema.js";

const KEY = "app-settings";

export type SettingsRepository = {
  read(): AppSettings;
  write(patch: Partial<AppSettings>): void;
};

export const createSettingsRepository = (db: Database.Database): SettingsRepository => {
  const selectStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertStmt = db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  const read = (): AppSettings => {
    const row = selectStmt.get(KEY) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(row.value) as unknown;
      const result = AppSettingsSchema.safeParse(parsed);
      return result.success ? result.data : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };

  const write = (patch: Partial<AppSettings>): void => {
    const current = read();
    const next = { ...current, ...patch };
    const validated = AppSettingsSchema.safeParse(next);
    const value = validated.success ? validated.data : current;
    upsertStmt.run(KEY, JSON.stringify(value));
  };

  return { read, write };
};
```

- [ ] **Step 4: Verify green**

- [ ] **Step 5: Commit**

```powershell
git add apps/main
git commit -m "feat(settings): add sqlite-backed settings repository"
```

---

## Task 4: Token redact filter + token validation

**Files:**
- Create: `apps/main/src/auth/token-redact.ts`
- Create: `apps/main/src/auth/token-validate.ts`
- Create: `apps/main/tests/auth.token-redact.test.ts`
- Create: `apps/main/tests/auth.token-validate.test.ts`

- [ ] **Step 1: Write failing test for redact**

`apps/main/tests/auth.token-redact.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redactToken, redactString } from "../src/auth/token-redact.js";

describe("redactToken", () => {
  it("masks an OAuth token preserving prefix", () => {
    const t = "sk-ant-oat-FAKEPRODUCTION_TOKEN_VALUE_HERE_xyz";
    expect(redactToken(t)).toBe("sk-ant-oat-...[REDACTED]");
  });

  it("returns empty for empty input", () => {
    expect(redactToken("")).toBe("");
  });

  it("masks even non-prefixed strings", () => {
    expect(redactToken("12345678")).toBe("12...[REDACTED]");
  });
});

describe("redactString", () => {
  it("redacts OAuth-shaped tokens inside larger strings", () => {
    const s = "Authorization: Bearer sk-ant-oat-PRODUCTION_TOKEN_xyz; trailing";
    expect(redactString(s)).toContain("[REDACTED]");
    expect(redactString(s)).not.toContain("PRODUCTION_TOKEN_xyz");
  });

  it("redacts API keys too", () => {
    const s = "key=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(redactString(s)).toContain("[REDACTED]");
  });

  it("passes through clean strings unchanged", () => {
    expect(redactString("plain log line")).toBe("plain log line");
  });
});
```

- [ ] **Step 2: Implement `apps/main/src/auth/token-redact.ts`**

```ts
const OAUTH_REGEX = /sk-ant-oat[A-Za-z0-9_-]{20,}/g;
const API_REGEX = /sk-ant-api03-[A-Za-z0-9_-]{50,}/g;

export const redactToken = (raw: string): string => {
  if (raw === "") return "";
  if (raw.length <= 12) return raw.slice(0, 2) + "...[REDACTED]";
  return raw.slice(0, 11) + "...[REDACTED]";
};

export const redactString = (s: string): string =>
  s.replace(OAUTH_REGEX, "[REDACTED]").replace(API_REGEX, "[REDACTED]");
```

- [ ] **Step 3: Write failing test for validate**

`apps/main/tests/auth.token-validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isWellFormedToken } from "../src/auth/token-validate.js";

describe("isWellFormedToken", () => {
  it("accepts an OAuth-shaped token", () => {
    expect(isWellFormedToken("sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isWellFormedToken("")).toBe(false);
  });

  it("rejects a too-short token", () => {
    expect(isWellFormedToken("sk-ant-oat-abc")).toBe(false);
  });

  it("rejects a non-OAuth-shaped string", () => {
    expect(isWellFormedToken("not-a-token")).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isWellFormedToken("  sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123  ")).toBe(true);
  });
});
```

- [ ] **Step 4: Implement `apps/main/src/auth/token-validate.ts`**

```ts
const OAUTH_REGEX = /^sk-ant-oat[A-Za-z0-9_-]{20,}$/;

export const isWellFormedToken = (raw: string): boolean =>
  OAUTH_REGEX.test(raw.trim());
```

- [ ] **Step 5: Verify green**

```powershell
pnpm --filter @dashboard-agent/main test
```

- [ ] **Step 6: Commit**

```powershell
git add apps/main
git commit -m "feat(auth): add token redact filter and well-formedness check"
```

---

## Task 5: Token storage (safeStorage + SQLite)

**Files:**
- Create: `apps/main/src/auth/token-storage.ts`
- Create: `apps/main/tests/auth.token-storage.test.ts`

- [ ] **Step 1: Write failing test (uses fake safeStorage)**

`apps/main/tests/auth.token-storage.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (raw: string) => Buffer.from("ENC:" + raw, "utf8"),
  decryptString: (buf: Buffer) => buf.toString("utf8").replace(/^ENC:/, ""),
};

vi.mock("electron", () => ({ safeStorage: fakeSafeStorage }));

import {
  saveToken,
  loadTokenStatus,
  loadDecryptedToken,
  clearToken,
} from "../src/auth/token-storage.js";

const RAW = "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
};

describe("token-storage", () => {
  it("returns empty status on fresh db", () => {
    const db = setup();
    expect(loadTokenStatus(db)).toEqual({ hasToken: false });
  });

  it("encrypts and persists a manual token", () => {
    const db = setup();
    saveToken(db, { raw: RAW, source: "manual" });
    const status = loadTokenStatus(db);
    expect(status.hasToken).toBe(true);
    if (status.hasToken) {
      expect(status.source).toBe("manual");
      expect(status.maskedPrefix.startsWith("sk-ant-oat")).toBe(true);
      expect(status.maskedPrefix).not.toContain("PRODUCTION_TOKEN");
    }
  });

  it("round-trips raw token via loadDecryptedToken", () => {
    const db = setup();
    saveToken(db, { raw: RAW, source: "auto-detect" });
    expect(loadDecryptedToken(db)).toBe(RAW);
  });

  it("clearToken resets status", () => {
    const db = setup();
    saveToken(db, { raw: RAW, source: "manual" });
    clearToken(db);
    expect(loadTokenStatus(db)).toEqual({ hasToken: false });
    expect(loadDecryptedToken(db)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    const db = setup();
    expect(() => saveToken(db, { raw: "not-a-token", source: "manual" })).toThrow();
  });
});
```

- [ ] **Step 2: Implement `apps/main/src/auth/token-storage.ts`**

```ts
import type Database from "better-sqlite3";
import { safeStorage } from "electron";
import type { TokenSource, TokenStatus } from "@dashboard-agent/shared";
import { isWellFormedToken } from "./token-validate.js";
import { redactToken } from "./token-redact.js";

const KEY_CIPHERTEXT = "auth.token.ciphertext";
const KEY_SOURCE = "auth.token.source";
const KEY_PREFIX = "auth.token.prefix";
const KEY_AT = "auth.token.configured_at";

type SaveInput = { raw: string; source: TokenSource };

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
  });
  tx();
};

export const loadTokenStatus = (db: Database.Database): TokenStatus => {
  const cipher = select(db, KEY_CIPHERTEXT);
  if (cipher === null) return { hasToken: false };
  const source = select(db, KEY_SOURCE);
  const prefix = select(db, KEY_PREFIX);
  const at = select(db, KEY_AT);
  if (source === null || prefix === null || at === null) return { hasToken: false };
  if (source !== "manual" && source !== "auto-detect") return { hasToken: false };
  return {
    hasToken: true,
    source,
    maskedPrefix: prefix,
    configuredAt: Number.parseInt(at, 10),
  };
};

export const loadDecryptedToken = (db: Database.Database): string | null => {
  const cipher64 = select(db, KEY_CIPHERTEXT);
  if (cipher64 === null) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(cipher64, "base64"));
};

export const clearToken = (db: Database.Database): void => {
  const tx = db.transaction(() => {
    remove(db, KEY_CIPHERTEXT);
    remove(db, KEY_SOURCE);
    remove(db, KEY_PREFIX);
    remove(db, KEY_AT);
  });
  tx();
};
```

- [ ] **Step 3: Verify green**

- [ ] **Step 4: Commit**

```powershell
git add apps/main
git commit -m "feat(auth): add token storage with safeStorage encryption"
```

---

## Task 6: Token auto-detect (`~/.claude/.credentials.json`)

**Files:**
- Create: `apps/main/src/auth/token-detect.ts`
- Create: `apps/main/tests/auth.token-detect.test.ts`

- [ ] **Step 1: Write failing test (uses fs mock)**

`apps/main/tests/auth.token-detect.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClaudeCliToken } from "../src/auth/token-detect.js";

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "da-home-"));
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
};

describe("detectClaudeCliToken", () => {
  it("returns null when ~/.claude does not exist", () => {
    const { home, cleanup } = setup();
    try {
      expect(detectClaudeCliToken(home)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns null when credentials.json is missing", () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      expect(detectClaudeCliToken(home)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns null when file is not parseable JSON", () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(join(home, ".claude", ".credentials.json"), "garbage");
      expect(detectClaudeCliToken(home)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("extracts a well-formed token when present", () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      const fake = {
        claudeAiOauth: { accessToken: "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123" },
      };
      writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify(fake));
      expect(detectClaudeCliToken(home)).toBe(
        "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123",
      );
    } finally {
      cleanup();
    }
  });

  it("returns null when the file exists but the token field is missing/malformed", () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(join(home, ".claude", ".credentials.json"), JSON.stringify({ other: 1 }));
      expect(detectClaudeCliToken(home)).toBeNull();
    } finally {
      cleanup();
    }
  });
});
```

- [ ] **Step 2: Implement `apps/main/src/auth/token-detect.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isWellFormedToken } from "./token-validate.js";

/**
 * Reads `<home>/.claude/.credentials.json` and tries to extract the OAuth access token.
 *
 * Returns the token string if a well-formed value is present, otherwise null.
 *
 * @param home - override of the user's home directory; defaults to os.homedir().
 *               Tests pass a temp directory here.
 */
export const detectClaudeCliToken = (home: string = homedir()): string | null => {
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
  if (typeof token !== "string") return null;
  return isWellFormedToken(token) ? token : null;
};
```

- [ ] **Step 3: Verify green**

- [ ] **Step 4: Commit**

```powershell
git add apps/main
git commit -m "feat(auth): add token auto-detect from claude cli credentials"
```

---

## Task 7: IPC handlers — settings + auth

**Files:**
- Create: `apps/main/src/ipc/settings-handlers.ts`
- Create: `apps/main/src/ipc/auth-handlers.ts`
- Modify: `apps/main/src/ipc/handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/main/src/index.ts` (pass db into handlers)
- Create: `apps/main/tests/ipc.settings-handlers.test.ts`
- Create: `apps/main/tests/ipc.auth-handlers.test.ts`

- [ ] **Step 1: Write failing test for settings handlers**

`apps/main/tests/ipc.settings-handlers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { registerSettingsHandlers } from "../src/ipc/settings-handlers.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

const setup = () => {
  handlers.clear();
  const db = new Database(":memory:");
  applyMigrations(db);
  registerSettingsHandlers(db);
  return db;
};

describe("settings ipc handlers", () => {
  it("settings:get returns defaults on empty db", async () => {
    setup();
    const get = handlers.get("settings:get");
    expect(get).toBeDefined();
    const result = (await Promise.resolve(get!({}))) as { language: string; theme: string };
    expect(result.language).toBe("pt-BR");
    expect(result.theme).toBe("light");
  });

  it("settings:update writes a partial and returns the new merged state", async () => {
    setup();
    const update = handlers.get("settings:update");
    expect(update).toBeDefined();
    const result = (await Promise.resolve(update!({}, { theme: "dark" }))) as {
      theme: string;
      language: string;
    };
    expect(result.theme).toBe("dark");
    expect(result.language).toBe("pt-BR");
  });
});
```

- [ ] **Step 2: Implement `apps/main/src/ipc/settings-handlers.ts`**

```ts
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type AppSettings } from "@dashboard-agent/shared";
import { createSettingsRepository } from "../settings/repository.js";

export const registerSettingsHandlers = (db: Database.Database): void => {
  const repo = createSettingsRepository(db);

  ipcMain.handle(IPC.SETTINGS_GET, (): AppSettings => repo.read());

  ipcMain.handle(IPC.SETTINGS_UPDATE, (_event, patch: unknown): AppSettings => {
    if (patch === null || typeof patch !== "object") return repo.read();
    repo.write(patch as Partial<AppSettings>);
    return repo.read();
  });
};
```

- [ ] **Step 3: Write failing test for auth handlers**

`apps/main/tests/ipc.auth-handlers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (raw: string) => Buffer.from("ENC:" + raw, "utf8"),
    decryptString: (buf: Buffer) => buf.toString("utf8").replace(/^ENC:/, ""),
  },
}));

import { registerAuthHandlers } from "../src/ipc/auth-handlers.js";

const setup = () => {
  handlers.clear();
  const db = new Database(":memory:");
  applyMigrations(db);
  const home = mkdtempSync(join(tmpdir(), "da-home-"));
  registerAuthHandlers(db, () => home);
  return { db, home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

const RAW = "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123";

describe("auth ipc handlers", () => {
  it("auth:token-status returns hasToken=false on empty db", async () => {
    const { cleanup } = setup();
    try {
      const status = await Promise.resolve(handlers.get("auth:token-status")!({}));
      expect(status).toEqual({ hasToken: false });
    } finally {
      cleanup();
    }
  });

  it("auth:token-set persists a valid token and returns redacted status", async () => {
    const { cleanup } = setup();
    try {
      const result = (await Promise.resolve(
        handlers.get("auth:token-set")!({}, { raw: RAW, source: "manual" }),
      )) as { hasToken: true; maskedPrefix: string };
      expect(result.hasToken).toBe(true);
      expect(result.maskedPrefix).toContain("sk-ant-oat");
      expect(result.maskedPrefix).not.toContain("PRODUCTION_TOKEN");
    } finally {
      cleanup();
    }
  });

  it("auth:token-set throws on malformed token", async () => {
    const { cleanup } = setup();
    try {
      await expect(
        Promise.resolve(
          handlers.get("auth:token-set")!({}, { raw: "garbage", source: "manual" }),
        ),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("auth:token-detect returns null when no credentials.json", async () => {
    const { cleanup } = setup();
    try {
      const result = await Promise.resolve(handlers.get("auth:token-detect")!({}));
      expect(result).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("auth:token-detect returns the token when credentials.json present", async () => {
    const { home, cleanup } = setup();
    try {
      mkdirSync(join(home, ".claude"));
      writeFileSync(
        join(home, ".claude", ".credentials.json"),
        JSON.stringify({ claudeAiOauth: { accessToken: RAW } }),
      );
      const result = await Promise.resolve(handlers.get("auth:token-detect")!({}));
      expect(result).toBe(RAW);
    } finally {
      cleanup();
    }
  });

  it("auth:token-clear removes the token", async () => {
    const { cleanup } = setup();
    try {
      await Promise.resolve(
        handlers.get("auth:token-set")!({}, { raw: RAW, source: "manual" }),
      );
      await Promise.resolve(handlers.get("auth:token-clear")!({}));
      const status = await Promise.resolve(handlers.get("auth:token-status")!({}));
      expect(status).toEqual({ hasToken: false });
    } finally {
      cleanup();
    }
  });
});
```

- [ ] **Step 4: Implement `apps/main/src/ipc/auth-handlers.ts`**

```ts
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { homedir } from "node:os";
import { IPC, type TokenSource, type TokenStatus } from "@dashboard-agent/shared";
import {
  saveToken,
  loadTokenStatus,
  clearToken,
} from "../auth/token-storage.js";
import { detectClaudeCliToken } from "../auth/token-detect.js";

type SetPayload = { raw: string; source: TokenSource };

export const registerAuthHandlers = (
  db: Database.Database,
  homeDirProvider: () => string = homedir,
): void => {
  ipcMain.handle(IPC.AUTH_TOKEN_STATUS, (): TokenStatus => loadTokenStatus(db));

  ipcMain.handle(IPC.AUTH_TOKEN_SET, (_event, payload: unknown): TokenStatus => {
    if (
      payload === null ||
      typeof payload !== "object" ||
      typeof (payload as SetPayload).raw !== "string"
    ) {
      throw new Error("Invalid payload for token-set");
    }
    const { raw, source } = payload as SetPayload;
    saveToken(db, { raw, source });
    return loadTokenStatus(db);
  });

  ipcMain.handle(IPC.AUTH_TOKEN_DETECT, (): string | null =>
    detectClaudeCliToken(homeDirProvider()),
  );

  ipcMain.handle(IPC.AUTH_TOKEN_CLEAR, (): TokenStatus => {
    clearToken(db);
    return loadTokenStatus(db);
  });
};
```

- [ ] **Step 5: Update `apps/main/src/ipc/handlers.ts`**

```ts
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@dashboard-agent/shared";
import { registerSettingsHandlers } from "./settings-handlers.js";
import { registerAuthHandlers } from "./auth-handlers.js";

export const registerIpcHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.PING, () => "pong");
  registerSettingsHandlers(db);
  registerAuthHandlers(db);
};
```

- [ ] **Step 6: Update `apps/main/src/ipc/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@dashboard-agent/shared";
import type {
  AppSettings,
  TokenSource,
  TokenStatus,
} from "@dashboard-agent/shared";

contextBridge.exposeInMainWorld("dashboardAgent", {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch),
  },
  auth: {
    status: (): Promise<TokenStatus> => ipcRenderer.invoke(IPC.AUTH_TOKEN_STATUS),
    set: (raw: string, source: TokenSource): Promise<TokenStatus> =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_SET, { raw, source }),
    detect: (): Promise<string | null> => ipcRenderer.invoke(IPC.AUTH_TOKEN_DETECT),
    clear: (): Promise<TokenStatus> => ipcRenderer.invoke(IPC.AUTH_TOKEN_CLEAR),
  },
});
```

- [ ] **Step 7: Update `apps/main/src/index.ts` to pass db**

```ts
// Update the line:
//   registerIpcHandlers();
// to:
//   registerIpcHandlers(db);
```

The full `index.ts` becomes:

```ts
import { app } from "electron";
import type { BrowserWindow, Tray } from "electron";
import type Database from "better-sqlite3";
import { createMainWindow } from "./window/main-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/index.js";
import { openDatabase } from "./db/client.js";
import { databasePath } from "./db/path.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;

const getWindow = (): BrowserWindow | null => mainWindow;

void app.whenReady().then(() => {
  db = openDatabase(databasePath());
  registerIpcHandlers(db);
  mainWindow = createMainWindow();
  tray = createTray(getWindow);
});

app.on("window-all-closed", () => {
  // Intentionally empty — keep app alive in tray.
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});

app.on("before-quit", () => {
  tray?.destroy();
  tray = null;
  db?.close();
  db = null;
});
```

- [ ] **Step 8: Verify green**

```powershell
pnpm --filter @dashboard-agent/main test
```

Expected: ~22 tests passing (8 existing + 2 settings handlers + 6 auth handlers + 6 settings repo + 6 schema = adjusted by exact counts).

- [ ] **Step 9: Commit**

```powershell
git add apps/main
git commit -m "feat(ipc): add settings and auth handlers wired to main process"
```

---

## Task 8: i18n setup (react-i18next)

**Files:**
- Create: `apps/renderer/src/i18n/index.ts`
- Create: `apps/renderer/src/i18n/pt-BR.json`
- Create: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/main.tsx`
- Modify: `apps/renderer/package.json` (add `i18next`, `react-i18next`)

- [ ] **Step 1: Add i18n deps**

```powershell
pnpm --filter @dashboard-agent/renderer add i18next@^23.15.1 react-i18next@^15.0.2
```

- [ ] **Step 2: Create `apps/renderer/src/i18n/pt-BR.json`** (seeds for M2 only)

```json
{
  "app": {
    "title": "Dashboard Agent"
  },
  "settings": {
    "title": "Configurações",
    "language": "Idioma",
    "theme": "Tema",
    "theme.light": "Claro",
    "theme.dark": "Escuro",
    "language.ptBR": "Português (BR)",
    "language.enUS": "English (US)",
    "auth.title": "OAuth Token",
    "auth.statusEmpty": "Nenhum token configurado",
    "auth.statusActive": "Token ativo",
    "auth.source.manual": "Inserido manualmente",
    "auth.source.autoDetect": "Detectado automaticamente",
    "auth.actionSet": "Salvar token",
    "auth.actionClear": "Remover token",
    "auth.tokenLabel": "Cole o token aqui",
    "auth.tokenInvalid": "Token inválido. Esperado formato sk-ant-oat-..."
  },
  "wizard": {
    "title": "Bem-vindo ao Dashboard Agent",
    "subtitle": "Vamos configurar seu OAuth token para começar.",
    "chooseMethod": "Como você prefere configurar?",
    "manualOption": "Cola manual (passo a passo)",
    "autoOption": "Detectar automaticamente do Claude Code CLI",
    "manualSteps.title": "Como gerar um OAuth token",
    "manualSteps.step1": "Abra um terminal (PowerShell ou Windows Terminal)",
    "manualSteps.step2": "Execute: claude setup-token",
    "manualSteps.step3": "Siga as instruções para autenticar no navegador",
    "manualSteps.step4": "Copie o token gerado e cole abaixo",
    "manualSteps.tokenInputPlaceholder": "sk-ant-oat-...",
    "manualSteps.continue": "Salvar e continuar",
    "autoSearching": "Procurando token em ~/.claude/.credentials.json...",
    "autoFound": "Token encontrado! Deseja importar?",
    "autoNotFound": "Nenhum token encontrado. Use a opção manual.",
    "autoConfirm": "Importar este token",
    "autoCancel": "Cancelar",
    "back": "Voltar",
    "skipForNow": "Continuar sem token (não recomendado)"
  },
  "common": {
    "save": "Salvar",
    "cancel": "Cancelar",
    "close": "Fechar"
  }
}
```

- [ ] **Step 3: Create `apps/renderer/src/i18n/en-US.json`**

```json
{
  "app": {
    "title": "Dashboard Agent"
  },
  "settings": {
    "title": "Settings",
    "language": "Language",
    "theme": "Theme",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "language.ptBR": "Portuguese (BR)",
    "language.enUS": "English (US)",
    "auth.title": "OAuth Token",
    "auth.statusEmpty": "No token configured",
    "auth.statusActive": "Token active",
    "auth.source.manual": "Entered manually",
    "auth.source.autoDetect": "Auto-detected",
    "auth.actionSet": "Save token",
    "auth.actionClear": "Remove token",
    "auth.tokenLabel": "Paste token here",
    "auth.tokenInvalid": "Invalid token. Expected format sk-ant-oat-..."
  },
  "wizard": {
    "title": "Welcome to Dashboard Agent",
    "subtitle": "Let's set up your OAuth token to get started.",
    "chooseMethod": "How would you like to configure?",
    "manualOption": "Manual paste (step-by-step)",
    "autoOption": "Auto-detect from Claude Code CLI",
    "manualSteps.title": "How to generate an OAuth token",
    "manualSteps.step1": "Open a terminal (PowerShell or Windows Terminal)",
    "manualSteps.step2": "Run: claude setup-token",
    "manualSteps.step3": "Follow the prompts to authenticate in your browser",
    "manualSteps.step4": "Copy the generated token and paste it below",
    "manualSteps.tokenInputPlaceholder": "sk-ant-oat-...",
    "manualSteps.continue": "Save and continue",
    "autoSearching": "Searching for token in ~/.claude/.credentials.json...",
    "autoFound": "Token found! Would you like to import it?",
    "autoNotFound": "No token found. Use the manual option instead.",
    "autoConfirm": "Import this token",
    "autoCancel": "Cancel",
    "back": "Back",
    "skipForNow": "Continue without a token (not recommended)"
  },
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "close": "Close"
  }
}
```

- [ ] **Step 4: Implement `apps/renderer/src/i18n/index.ts`**

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@dashboard-agent/shared";
import ptBR from "./pt-BR.json";
import enUS from "./en-US.json";

void i18n.use(initReactI18next).init({
  resources: {
    "pt-BR": { translation: ptBR },
    "en-US": { translation: enUS },
  },
  lng: "pt-BR",
  fallbackLng: "pt-BR",
  interpolation: { escapeValue: false },
});

export const setLanguage = (lang: Language): void => {
  void i18n.changeLanguage(lang);
};

export default i18n;
```

- [ ] **Step 5: Update `apps/renderer/tsconfig.json` to allow JSON imports**

The base tsconfig already has `resolveJsonModule: true`, so this works without changes. Just verify by reading the file.

- [ ] **Step 6: Update `apps/renderer/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./i18n/index.js";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 7: Verify build**

```powershell
pnpm --filter @dashboard-agent/renderer build
```

- [ ] **Step 8: Commit**

```powershell
git add apps/renderer pnpm-lock.yaml
git commit -m "feat(i18n): add react-i18next with pt-BR and en-US bundles"
```

---

## Task 9: Theme tokens + ThemeProvider

**Files:**
- Create: `apps/renderer/src/theme/tokens.css`
- Create: `apps/renderer/src/theme/ThemeProvider.tsx`
- Modify: `apps/renderer/src/styles/index.css`

- [ ] **Step 1: Create `apps/renderer/src/theme/tokens.css`** (CSS variables for both themes)

```css
:root {
  --c-bg: #ffffff;
  --c-bg-soft: #f5f5fa;
  --c-bg-card: #ffffff;
  --c-border: #e8e8e8;
  --c-border-strong: #d4d4da;
  --c-text: #070c27;
  --c-text-muted: #48484a;
  --c-text-soft: #969696;
  --c-primary: #1d5dd7;
  --c-primary-dark: #001d5a;
  --c-primary-soft: #bee0fe;
  --c-primary-bg: #eaf2fe;
  --c-accent: #5bc4e7;
}

html.dark {
  --c-bg: #070c27;
  --c-bg-soft: #0f1733;
  --c-bg-card: #111935;
  --c-border: #1f2747;
  --c-border-strong: #2a335a;
  --c-text: #ffffff;
  --c-text-muted: #c4c8d4;
  --c-text-soft: #8089a0;
  --c-primary: #4a85e7;
  --c-primary-dark: #1d5dd7;
  --c-primary-soft: #1f3a73;
  --c-primary-bg: #142347;
  --c-accent: #5bc4e7;
}
```

- [ ] **Step 2: Update `apps/renderer/src/styles/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import "../theme/tokens.css";
```

- [ ] **Step 3: Implement `apps/renderer/src/theme/ThemeProvider.tsx`**

```tsx
import { useEffect } from "react";
import type { Theme } from "@dashboard-agent/shared";

export const applyTheme = (theme: Theme): void => {
  const html = document.documentElement;
  html.classList.toggle("dark", theme === "dark");
};

type Props = {
  theme: Theme;
  children: React.ReactNode;
};

export const ThemeProvider = ({ theme, children }: Props) => {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return <>{children}</>;
};
```

- [ ] **Step 4: Commit**

```powershell
git add apps/renderer
git commit -m "feat(theme): add light/dark css tokens and theme provider"
```

---

## Task 10: Settings store (Zustand) + IPC sync

**Files:**
- Create: `apps/renderer/src/stores/settings.ts`
- Modify: `apps/renderer/package.json` (add `zustand`)

- [ ] **Step 1: Add zustand**

```powershell
pnpm --filter @dashboard-agent/renderer add zustand@^4.5.5
```

- [ ] **Step 2: Implement `apps/renderer/src/stores/settings.ts`**

```ts
import { create } from "zustand";
import type { AppSettings, Language, Theme } from "@dashboard-agent/shared";
import { setLanguage } from "../i18n/index.js";
import { applyTheme } from "../theme/ThemeProvider.js";

type State = {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
};

export const useSettingsStore = create<State>((set, get) => ({
  settings: { language: "pt-BR", theme: "light" },
  loaded: false,

  load: async () => {
    const fresh = await window.dashboardAgent.settings.get();
    setLanguage(fresh.language);
    applyTheme(fresh.theme);
    set({ settings: fresh, loaded: true });
  },

  setLanguage: async (lang) => {
    const next = await window.dashboardAgent.settings.update({ language: lang });
    setLanguage(next.language);
    set({ settings: next });
  },

  setTheme: async (theme) => {
    const next = await window.dashboardAgent.settings.update({ theme });
    applyTheme(next.theme);
    set({ settings: next });
  },
}));
```

- [ ] **Step 3: Update `apps/renderer/src/env.d.ts`** (extend the dashboardAgent type)

```ts
/// <reference types="vite/client" />
import type {
  AppSettings,
  TokenSource,
  TokenStatus,
} from "@dashboard-agent/shared";

declare global {
  interface Window {
    dashboardAgent: {
      ping: () => Promise<string>;
      settings: {
        get: () => Promise<AppSettings>;
        update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
      };
      auth: {
        status: () => Promise<TokenStatus>;
        set: (raw: string, source: TokenSource) => Promise<TokenStatus>;
        detect: () => Promise<string | null>;
        clear: () => Promise<TokenStatus>;
      };
    };
  }
}
export {};
```

- [ ] **Step 4: Verify typecheck**

```powershell
pnpm --filter @dashboard-agent/renderer typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add apps/renderer pnpm-lock.yaml
git commit -m "feat(renderer): add zustand settings store with ipc sync"
```

---

## Task 11: Components — ThemeToggle, LanguageToggle, SidebarFooter

**Files:**
- Create: `apps/renderer/src/components/ThemeToggle.tsx`
- Create: `apps/renderer/src/components/LanguageToggle.tsx`
- Create: `apps/renderer/src/components/SidebarFooter.tsx`

- [ ] **Step 1: Implement `apps/renderer/src/components/ThemeToggle.tsx`**

```tsx
import { useSettingsStore } from "../stores/settings.js";
import { useTranslation } from "react-i18next";

export const ThemeToggle = () => {
  const { t } = useTranslation();
  const { settings, setTheme } = useSettingsStore();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-muted">{t("settings.theme")}</span>
      <div className="flex gap-0.5 rounded-md bg-surface-soft p-0.5">
        <button
          onClick={() => void setTheme("light")}
          className={`px-2 py-1 text-xs font-semibold rounded ${
            settings.theme === "light"
              ? "bg-brand text-white"
              : "text-ink-soft hover:text-ink"
          }`}
          aria-label={t("settings.theme.light")}
          type="button"
        >
          ☀
        </button>
        <button
          onClick={() => void setTheme("dark")}
          className={`px-2 py-1 text-xs font-semibold rounded ${
            settings.theme === "dark"
              ? "bg-brand text-white"
              : "text-ink-soft hover:text-ink"
          }`}
          aria-label={t("settings.theme.dark")}
          type="button"
        >
          ☾
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Implement `apps/renderer/src/components/LanguageToggle.tsx`**

```tsx
import { useSettingsStore } from "../stores/settings.js";
import { useTranslation } from "react-i18next";

export const LanguageToggle = () => {
  const { t } = useTranslation();
  const { settings, setLanguage } = useSettingsStore();

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-muted">{t("settings.language")}</span>
      <div className="flex gap-0.5 rounded-md bg-surface-soft p-0.5">
        <button
          onClick={() => void setLanguage("pt-BR")}
          className={`px-2 py-1 text-xs font-semibold rounded ${
            settings.language === "pt-BR"
              ? "bg-brand text-white"
              : "text-ink-soft hover:text-ink"
          }`}
          type="button"
        >
          PT
        </button>
        <button
          onClick={() => void setLanguage("en-US")}
          className={`px-2 py-1 text-xs font-semibold rounded ${
            settings.language === "en-US"
              ? "bg-brand text-white"
              : "text-ink-soft hover:text-ink"
          }`}
          type="button"
        >
          EN
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Implement `apps/renderer/src/components/SidebarFooter.tsx`**

```tsx
import { ThemeToggle } from "./ThemeToggle.js";
import { LanguageToggle } from "./LanguageToggle.js";

export const SidebarFooter = () => (
  <div className="mt-auto pt-3 border-t border-surface-border flex flex-col gap-2 px-2">
    <LanguageToggle />
    <ThemeToggle />
  </div>
);
```

- [ ] **Step 4: Commit**

```powershell
git add apps/renderer
git commit -m "feat(renderer): add theme/language toggles and sidebar footer"
```

---

## Task 12: Settings page + Setup wizard + App routing

**Files:**
- Create: `apps/renderer/src/routes/Settings.tsx`
- Create: `apps/renderer/src/routes/SetupWizard.tsx`
- Create: `apps/renderer/src/routes/Dashboard.tsx`
- Modify: `apps/renderer/src/App.tsx`
- Modify: `apps/renderer/package.json` (add `react-router-dom`)

- [ ] **Step 1: Add react-router-dom**

```powershell
pnpm --filter @dashboard-agent/renderer add react-router-dom@^6.27.0
```

- [ ] **Step 2: Create `apps/renderer/src/routes/Dashboard.tsx`** (placeholder until M6)

```tsx
import { useTranslation } from "react-i18next";

export const Dashboard = () => {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-brand-dark">{t("app.title")}</h1>
      <p className="text-ink-muted mt-2">M2 — Auth & Settings done. Dashboard widgets land in M6.</p>
    </div>
  );
};
```

- [ ] **Step 3: Create `apps/renderer/src/routes/Settings.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TokenStatus } from "@dashboard-agent/shared";

export const Settings = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TokenStatus>({ hasToken: false });
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setStatus(await window.dashboardAgent.auth.status());

  useEffect(() => {
    void refresh();
  }, []);

  const onSave = async () => {
    setError(null);
    try {
      await window.dashboardAgent.auth.set(tokenInput, "manual");
      setTokenInput("");
      await refresh();
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  const onClear = async () => {
    await window.dashboardAgent.auth.clear();
    await refresh();
  };

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-6">{t("settings.title")}</h1>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-3">
          {t("settings.auth.title")}
        </h2>
        {status.hasToken ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {t("settings.auth.statusActive")}: <code>{status.maskedPrefix}</code>
            </p>
            <p className="text-xs text-ink-muted">
              {status.source === "manual"
                ? t("settings.auth.source.manual")
                : t("settings.auth.source.autoDetect")}
            </p>
            <button
              onClick={() => void onClear()}
              className="text-sm text-semantic-danger hover:underline"
              type="button"
            >
              {t("settings.auth.actionClear")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">{t("settings.auth.statusEmpty")}</p>
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="sk-ant-oat-..."
              className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
            />
            {error && <p className="text-xs text-semantic-danger">{error}</p>}
            <button
              onClick={() => void onSave()}
              disabled={tokenInput.length === 0}
              className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded disabled:opacity-50"
              type="button"
            >
              {t("settings.auth.actionSet")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
```

- [ ] **Step 4: Create `apps/renderer/src/routes/SetupWizard.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

type Step = "choose" | "manual" | "auto";

export const SetupWizard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("choose");
  const [tokenInput, setTokenInput] = useState("");
  const [autoToken, setAutoToken] = useState<string | null>(null);
  const [autoSearched, setAutoSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goAuto = async () => {
    setStep("auto");
    setError(null);
    const found = await window.dashboardAgent.auth.detect();
    setAutoToken(found);
    setAutoSearched(true);
  };

  const importAuto = async () => {
    if (autoToken === null) return;
    try {
      await window.dashboardAgent.auth.set(autoToken, "auto-detect");
      navigate("/dashboard");
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  const saveManual = async () => {
    setError(null);
    try {
      await window.dashboardAgent.auth.set(tokenInput, "manual");
      navigate("/dashboard");
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl w-full bg-surface-card border border-surface-border rounded-xl p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-brand-dark mb-2">{t("wizard.title")}</h1>
        <p className="text-sm text-ink-muted mb-6">{t("wizard.subtitle")}</p>

        {step === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-ink font-medium">{t("wizard.chooseMethod")}</p>
            <button
              onClick={() => setStep("manual")}
              className="w-full text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
              type="button"
            >
              <div className="text-sm font-semibold text-ink">{t("wizard.manualOption")}</div>
            </button>
            <button
              onClick={() => void goAuto()}
              className="w-full text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
              type="button"
            >
              <div className="text-sm font-semibold text-ink">{t("wizard.autoOption")}</div>
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className="w-full text-xs text-ink-soft hover:underline mt-4"
              type="button"
            >
              {t("wizard.skipForNow")}
            </button>
          </div>
        )}

        {step === "manual" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-brand-dark">
              {t("wizard.manualSteps.title")}
            </h3>
            <ol className="list-decimal list-inside text-sm text-ink-muted space-y-1">
              <li>{t("wizard.manualSteps.step1")}</li>
              <li>{t("wizard.manualSteps.step2")}</li>
              <li>{t("wizard.manualSteps.step3")}</li>
              <li>{t("wizard.manualSteps.step4")}</li>
            </ol>
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={t("wizard.manualSteps.tokenInputPlaceholder")}
              className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono mt-3"
            />
            {error && <p className="text-xs text-semantic-danger">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("choose")}
                className="px-4 py-2 text-sm text-ink hover:bg-surface-soft rounded"
                type="button"
              >
                {t("wizard.back")}
              </button>
              <button
                onClick={() => void saveManual()}
                disabled={tokenInput.length === 0}
                className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded disabled:opacity-50"
                type="button"
              >
                {t("wizard.manualSteps.continue")}
              </button>
            </div>
          </div>
        )}

        {step === "auto" && (
          <div className="space-y-3">
            {!autoSearched && <p className="text-sm text-ink-muted">{t("wizard.autoSearching")}</p>}
            {autoSearched && autoToken !== null && (
              <>
                <p className="text-sm text-ink">{t("wizard.autoFound")}</p>
                <code className="block text-xs bg-surface-soft p-2 rounded text-ink-muted">
                  {autoToken.slice(0, 14)}...
                </code>
              </>
            )}
            {autoSearched && autoToken === null && (
              <p className="text-sm text-ink-muted">{t("wizard.autoNotFound")}</p>
            )}
            {error && <p className="text-xs text-semantic-danger">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("choose")}
                className="px-4 py-2 text-sm text-ink hover:bg-surface-soft rounded"
                type="button"
              >
                {t("wizard.back")}
              </button>
              {autoSearched && autoToken !== null && (
                <button
                  onClick={() => void importAuto()}
                  className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded"
                  type="button"
                >
                  {t("wizard.autoConfirm")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Update `apps/renderer/src/App.tsx` (router + first-run gate)**

```tsx
import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSettingsStore } from "./stores/settings.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Settings } from "./routes/Settings.js";
import { SetupWizard } from "./routes/SetupWizard.js";
import { SidebarFooter } from "./components/SidebarFooter.js";

const Sidebar = () => (
  <aside className="w-56 bg-surface border-r border-surface-border flex flex-col p-3">
    <h1 className="px-2 mb-4 text-sm font-bold text-brand-dark">Dashboard Agent</h1>
    <nav className="flex flex-col gap-1 text-sm text-ink-muted">
      <a href="#/dashboard" className="px-2 py-1 hover:bg-surface-soft rounded">
        Dashboard
      </a>
      <a href="#/settings" className="px-2 py-1 hover:bg-surface-soft rounded">
        Settings
      </a>
    </nav>
    <SidebarFooter />
  </aside>
);

const Layout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen flex">
    <Sidebar />
    <main className="flex-1 overflow-auto">{children}</main>
  </div>
);

export const App = () => {
  const { load, loaded } = useSettingsStore();
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    const init = async () => {
      await load();
      const status = await window.dashboardAgent.auth.status();
      setHasToken(status.hasToken);
    };
    void init();
  }, [load]);

  if (!loaded || hasToken === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-soft">
        <p className="text-ink-muted">Loading…</p>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/setup"
          element={hasToken ? <Navigate to="/dashboard" replace /> : <SetupWizard />}
        />
        <Route
          path="/dashboard"
          element={
            hasToken ? (
              <Layout>
                <Dashboard />
              </Layout>
            ) : (
              <Navigate to="/setup" replace />
            )
          }
        />
        <Route
          path="/settings"
          element={
            <Layout>
              <Settings />
            </Layout>
          }
        />
        <Route
          path="*"
          element={<Navigate to={hasToken ? "/dashboard" : "/setup"} replace />}
        />
      </Routes>
    </HashRouter>
  );
};
```

> Note: the renderer no longer shows the IPC ping result. The `ping` channel still exists for diagnostics but no longer drives the UI.

- [ ] **Step 6: Verify build**

```powershell
pnpm --filter @dashboard-agent/renderer build
pnpm --filter @dashboard-agent/main build
```

- [ ] **Step 7: Commit**

```powershell
git add apps/renderer pnpm-lock.yaml
git commit -m "feat(routes): add settings page, setup wizard, and first-run routing"
```

---

## Task 13: Smoke test + DoD

- [ ] **Step 1: Run full pipeline**

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 2: Manual end-to-end check**

```powershell
pnpm dev
```

Verify in the Electron window:

- [ ] First launch (with no token in DB): app navigates to `/setup` and shows the wizard
- [ ] Wizard "Manual" path: pasting a valid token saves it, navigates to `/dashboard`
- [ ] Wizard "Auto" path: if `~/.claude/.credentials.json` exists, it offers to import
- [ ] Sidebar footer shows PT/EN and ☀/☾ toggles
- [ ] Clicking EN switches all on-screen text to English without reload
- [ ] Clicking ☾ flips the page to dark theme without reload
- [ ] Closing and reopening the app preserves theme + language (read from SQLite on start)
- [ ] Going to Settings shows a redacted token preview (`sk-ant-oat-...[REDACTED]`)
- [ ] "Remove token" returns the app to no-token state and on next launch routes to `/setup`

- [ ] **Step 3: Final commit if anything drifted**

```powershell
git status
```

If clean, M2 is done.

---

## M2 Definition of Done

- [ ] OAuth token persisted via `safeStorage` (DPAPI on Windows); never logged or returned raw to renderer
- [ ] Settings (theme, language) persisted in SQLite `settings` table and survive restarts
- [ ] Theme switcher toggles light/dark without reload
- [ ] Language switcher toggles pt-BR/en-US without reload, no mixed-language screens
- [ ] First-run wizard offers manual + auto-detect paths
- [ ] Auto-detect reads `~/.claude/.credentials.json` and imports if a well-formed token is present
- [ ] No-token state routes to `/setup`; with-token state allows `/dashboard` and `/settings`
- [ ] All existing M1 tests still pass plus new tests for: settings schema, settings repository, token-redact, token-validate, token-storage, token-detect, settings-handlers, auth-handlers
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green
- [ ] Pre-commit hooks (gitleaks, lint-staged, commitlint) still pass on every commit

---

## Notes for the implementing engineer

- **Token bytes never leave the main process.** `loadDecryptedToken()` is internal only. The renderer only sees the `TokenStatus` payload (`hasToken`, `maskedPrefix`, `source`, `configuredAt`). Future milestones (M3 Orchestrator) will read the token directly from the main process when spawning Claude — not via IPC.
- **i18n coverage**: only seeded for M2-relevant copy. Future milestones add their own keys to both `pt-BR.json` and `en-US.json` symmetrically. A lint script to detect missing keys is a v2 concern.
- **HashRouter** is used (not BrowserRouter) because Electron loads the renderer via `file://`, which doesn't support pushState routing without extra config.
- **`safeStorage` on Mac/Linux**: works the same way (Keychain / libsecret) but tests use a mock since this milestone targets Windows. Cross-platform verification deferred.
- **Don't expose `loadDecryptedToken` over IPC** — that's the most important security invariant. The token never crosses the process boundary toward the renderer.
