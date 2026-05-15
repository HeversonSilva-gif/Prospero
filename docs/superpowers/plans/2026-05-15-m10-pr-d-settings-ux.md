# M10 PR-D — Settings + Per-Agent Remote Execution UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user enable remote (Docker/VPS) agent execution from Settings and pick each agent's location (local vs remote) at hire time and in Agent Studio.

**Architecture:** Remote-execution config lives in the `app-settings` JSON blob (no DB migration). A new `RemoteExecutionSettings` field flows: Settings UI → `settings:update` IPC → a module-level resolver in the remote-docker connection manager that `createProductionTransport` reads. Per-agent location is just the existing `agents.adapter_name` column — `claude-oauth-remote-docker` for remote, `claude-oauth-local`/`claude-api-key-local` for local. The hire path and a new `agents:set-adapter` IPC write that column; the next spawn picks it up.

**Tech Stack:** TypeScript, Electron (main), React + Zustand + react-i18next (renderer), zod (apps only), better-sqlite3, vitest. pnpm monorepo (`@prospero/shared`, `@prospero/main`, `@prospero/renderer`).

**Pre-req closed:** M10 PR-A + PR-B + PR-C merged. HEAD `8f70e9b`, 953 tests passing. Spec: §7 of `docs/superpowers/specs/2026-05-15-m10-vps-docker-adapter-design.md`.

**Conventions:**
- TDD: failing test → minimal impl → green → commit.
- commitlint rejects uppercase / `+` / `%` in the subject line. Use lowercase `feat(m10): ...`.
- Single main test run (triggers a `better-sqlite3` rebuild via `pretest`): `pnpm --filter @prospero/main run test <relative/path>`. Shared: `pnpm --filter @prospero/shared run test <relative/path>`. Renderer: `pnpm --filter @prospero/renderer run test <relative/path>`.
- Full gate: `pnpm typecheck && pnpm lint && pnpm test` from the repo root.
- zod NEVER in `packages/shared` (it bundles into the Electron preload sandbox). Runtime schemas live in `apps/main`.

---

## File Structure

**Created:**
- `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.test.ts` — tests for `toRemoteExecutionConfig`.
- `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/test-connection.ts` — throwaway-connection health check for the Settings "test connection" button.
- `apps/main/src/orchestrator/adapter-credentials.ts` — pure adapter-name → credential resolver.
- `apps/main/src/orchestrator/adapter-credentials.test.ts` — tests for it.
- `apps/main/src/agents/hire-adapter.ts` — pure `location` + `authMode` → `AdapterName` picker.
- `apps/main/src/agents/hire-adapter.test.ts` — tests for it.
- `apps/renderer/src/components/settings/RemoteExecutionSection.tsx` — the new Settings section.

**Modified:** `packages/shared/src/types/settings.ts`, `packages/shared/src/types/hire-agent-input.ts`, `packages/shared/src/ipc-channels.ts`, `packages/shared/tests/settings.test.ts`, `apps/main/src/settings/schema.ts`, `apps/main/src/settings/schema.test.ts`, `apps/main/tests/settings.schema.test.ts`, `apps/main/tests/settings.repository.test.ts`, `apps/main/tests/costs.recorder.test.ts`, `apps/main/tests/agents.adapter-name.test.ts`, `apps/main/src/settings/schema.ts`, `apps/main/src/schemas/hire-agent-input.ts`, `apps/main/src/agents/repository.ts`, `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.ts`, `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.ts`, `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts`, `apps/main/src/ipc/orchestrator-handlers.ts`, `apps/main/src/ipc/preload.ts`, `apps/renderer/src/env.d.ts`, `apps/renderer/src/stores/settings.ts`, `apps/renderer/src/stores/agents.ts`, `apps/renderer/src/routes/Settings.tsx`, `apps/renderer/src/routes/AgentNew.tsx`, `apps/renderer/src/components/agent-panel/ConfigTab.tsx`, `apps/renderer/src/i18n/pt-BR.json`, `apps/renderer/src/i18n/en-US.json`, `apps/renderer/src/i18n/parity.test.ts`.

---

## Task 1: `RemoteExecutionSettings` in `AppSettings`

Adds the settings type, default, zod schema, `parseSettings` handling, and updates every call site that constructs a full `AppSettings` (a new required field breaks them — `toEqual` test failures + renderer-store typecheck error).

**Files:**
- Modify: `packages/shared/src/types/settings.ts`
- Modify: `apps/main/src/settings/schema.ts`
- Test: `apps/main/src/settings/schema.test.ts`
- Modify (call sites): `apps/main/tests/settings.schema.test.ts`, `apps/main/tests/settings.repository.test.ts`, `packages/shared/tests/settings.test.ts`, `apps/renderer/src/stores/settings.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/main/src/settings/schema.test.ts`:

```typescript
describe("parseSettings remoteExecution", () => {
  it("defaults to disabled local-docker when absent", () => {
    expect(parseSettings({}).remoteExecution).toEqual({
      enabled: false,
      mode: "local-docker",
      vpsHost: "",
      vpsUser: "",
      vpsKeyPath: "",
    });
  });

  it("preserves a valid remote-vps config", () => {
    const remoteExecution = {
      enabled: true,
      mode: "remote-vps" as const,
      vpsHost: "1.2.3.4",
      vpsUser: "deploy",
      vpsKeyPath: "/home/u/.ssh/id_ed25519",
    };
    expect(parseSettings({ remoteExecution }).remoteExecution).toEqual(remoteExecution);
  });

  it("fills nested defaults for a partial remoteExecution object", () => {
    expect(parseSettings({ remoteExecution: { enabled: true } }).remoteExecution).toEqual({
      enabled: true,
      mode: "local-docker",
      vpsHost: "",
      vpsUser: "",
      vpsKeyPath: "",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main run test src/settings/schema.test.ts`
Expected: FAIL — the three new tests fail because `parseSettings({}).remoteExecution` is `undefined`.

- [ ] **Step 3: Add the shared type + default**

In `packages/shared/src/types/settings.ts`, add after `export type AuthMode = ...` (line 24):

```typescript
export type RemoteExecutionMode = "local-docker" | "remote-vps";

export type RemoteExecutionSettings = {
  enabled: boolean;
  mode: RemoteExecutionMode;
  vpsHost: string;
  vpsUser: string;
  vpsKeyPath: string;
};
```

Add `remoteExecution: RemoteExecutionSettings;` as the last field of `AppSettings`:

```typescript
export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;
  defaultModelForNewAgents: string;
  executorMode: ExecutorMode;
  activeCompanyId: string | null;
  authMode: AuthMode;
  defaultAgentMode: AgentMode;
  defaultAlwaysOn: boolean;
  remoteExecution: RemoteExecutionSettings;
};
```

Add the default as the last field of `DEFAULT_SETTINGS`:

```typescript
export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
  defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
  executorMode: "atomic",
  activeCompanyId: null,
  authMode: "oauth",
  defaultAgentMode: "supervised",
  defaultAlwaysOn: false,
  remoteExecution: {
    enabled: false,
    mode: "local-docker",
    vpsHost: "",
    vpsUser: "",
    vpsKeyPath: "",
  },
};
```

- [ ] **Step 4: Add the zod schema + parseSettings handling**

In `apps/main/src/settings/schema.ts`, add before `export const AppSettingsSchema`:

```typescript
export const RemoteExecutionSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["local-docker", "remote-vps"]).default("local-docker"),
  vpsHost: z.string().default(""),
  vpsUser: z.string().default(""),
  vpsKeyPath: z.string().default(""),
});
```

Add to `AppSettingsSchema` (as the last field):

```typescript
  defaultAlwaysOn: z.boolean().default(false),
  remoteExecution: RemoteExecutionSettingsSchema.default({
    enabled: false,
    mode: "local-docker",
    vpsHost: "",
    vpsUser: "",
    vpsKeyPath: "",
  }),
});
```

Add to `parseSettings`, before `return merged;`:

```typescript
  if (result.data.remoteExecution !== undefined) {
    merged.remoteExecution = result.data.remoteExecution;
  }
  return merged;
```

- [ ] **Step 5: Update the 7 call sites that construct a full `AppSettings`**

In `apps/main/tests/settings.schema.test.ts`, the three `toEqual({...})` objects (the `parseSettings fills defaults`, `preserves valid partial input`, and `drops unknown keys` tests) each need this added after `defaultAlwaysOn: false,`:

```typescript
      defaultAlwaysOn: false,
      remoteExecution: {
        enabled: false,
        mode: "local-docker",
        vpsHost: "",
        vpsUser: "",
        vpsKeyPath: "",
      },
    });
```

In `apps/main/tests/settings.repository.test.ts`, the three `toEqual({...})` objects (`returns defaults on empty db`, `persists a single field via write()`, `persists multiple fields`) each get the same `remoteExecution` block appended after `defaultAlwaysOn: false,`.

In `packages/shared/tests/settings.test.ts`, the `const s: AppSettings = {...}` object gets `remoteExecution` appended after `defaultAlwaysOn: false,`:

```typescript
      defaultAlwaysOn: false,
      remoteExecution: {
        enabled: false,
        mode: "local-docker",
        vpsHost: "",
        vpsUser: "",
        vpsKeyPath: "",
      },
    };
```

In `apps/renderer/src/stores/settings.ts`, the initial `settings:` object inside `create<State>` gets `remoteExecution` appended after `defaultAlwaysOn: false,`:

```typescript
    defaultAlwaysOn: false,
    remoteExecution: {
      enabled: false,
      mode: "local-docker",
      vpsHost: "",
      vpsUser: "",
      vpsKeyPath: "",
    },
  },
  loaded: false,
```

- [ ] **Step 6: Run the suites to verify green**

Run: `pnpm --filter @prospero/shared run test && pnpm --filter @prospero/main run test src/settings/schema.test.ts tests/settings.schema.test.ts tests/settings.repository.test.ts`
Expected: PASS — all settings tests green.

Run: `pnpm typecheck`
Expected: PASS. If typecheck reports any *other* file constructing a full `AppSettings` literal, add the `remoteExecution` block there too and rerun.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/settings.ts apps/main/src/settings/schema.ts apps/main/src/settings/schema.test.ts apps/main/tests/settings.schema.test.ts apps/main/tests/settings.repository.test.ts packages/shared/tests/settings.test.ts apps/renderer/src/stores/settings.ts
git commit -m "feat(m10): add remoteExecution to app settings"
```

---

## Task 2: `toRemoteExecutionConfig` mapper + config resolver + boot wiring

Maps `RemoteExecutionSettings` (UI shape) to `RemoteExecutionConfig` (transport shape), and installs a module-level resolver so `createProductionTransport` reads the live config instead of the hardcoded `DEFAULT_LOCAL_DOCKER_CONFIG`.

**Files:**
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.ts`
- Test: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.test.ts` (create)
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.ts`
- Test: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

- [ ] **Step 1: Write the failing test for the mapper**

Create `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { RemoteExecutionSettings } from "@prospero/shared";
import { toRemoteExecutionConfig } from "./config.js";

describe("toRemoteExecutionConfig", () => {
  it("maps local-docker settings to a local-docker config with the fixed image", () => {
    const settings: RemoteExecutionSettings = {
      enabled: true,
      mode: "local-docker",
      vpsHost: "",
      vpsUser: "",
      vpsKeyPath: "",
    };
    expect(toRemoteExecutionConfig(settings)).toEqual({
      mode: "local-docker",
      image: "prospero/agent-runner:dev",
    });
  });

  it("maps remote-vps settings to a remote-vps config carrying the SSH fields", () => {
    const settings: RemoteExecutionSettings = {
      enabled: true,
      mode: "remote-vps",
      vpsHost: "1.2.3.4",
      vpsUser: "deploy",
      vpsKeyPath: "/home/u/.ssh/id_ed25519",
    };
    expect(toRemoteExecutionConfig(settings)).toEqual({
      mode: "remote-vps",
      image: "prospero/agent-runner:dev",
      sshHost: "1.2.3.4",
      sshUser: "deploy",
      sshKeyPath: "/home/u/.ssh/id_ed25519",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/config.test.ts`
Expected: FAIL — `toRemoteExecutionConfig` is not exported.

- [ ] **Step 3: Implement the mapper**

Append to `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.ts`:

```typescript
import type { RemoteExecutionSettings } from "@prospero/shared";

/** Fixed runner image tag — not user-configurable (design §7). */
const RUNNER_IMAGE = "prospero/agent-runner:dev";

/**
 * Maps the user-facing RemoteExecutionSettings (the `app-settings` blob) to the
 * RemoteExecutionConfig the transport layer consumes. Pure — unit-tested.
 */
export const toRemoteExecutionConfig = (
  s: RemoteExecutionSettings,
): RemoteExecutionConfig => {
  if (s.mode === "remote-vps") {
    return {
      mode: "remote-vps",
      image: RUNNER_IMAGE,
      sshHost: s.vpsHost,
      sshUser: s.vpsUser,
      sshKeyPath: s.vpsKeyPath,
    };
  }
  return { mode: "local-docker", image: RUNNER_IMAGE };
};
```

- [ ] **Step 4: Run the mapper test to verify it passes**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the resolver**

Append to `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts` (a new `describe` at the end of the file):

```typescript
describe("remote-execution config resolver", () => {
  it("defaults to local Docker before any resolver is installed", () => {
    expect(resolveRemoteExecutionConfig()).toEqual(DEFAULT_LOCAL_DOCKER_CONFIG);
  });

  it("returns the installed resolver's config", () => {
    const cfg: RemoteExecutionConfig = {
      mode: "remote-vps",
      image: "x",
      sshHost: "h",
      sshUser: "u",
      sshKeyPath: "k",
    };
    setRemoteExecutionConfigResolver(() => cfg);
    expect(resolveRemoteExecutionConfig()).toBe(cfg);
  });
});
```

At the top of `connection-manager.test.ts`, extend the existing import from `./connection-manager.js` to also pull `resolveRemoteExecutionConfig` and `setRemoteExecutionConfigResolver`, and add an import for the config types. If the file does not already import them, add:

```typescript
import {
  resolveRemoteExecutionConfig,
  setRemoteExecutionConfigResolver,
} from "./connection-manager.js";
import { DEFAULT_LOCAL_DOCKER_CONFIG, type RemoteExecutionConfig } from "./config.js";
```

(Merge into existing import statements from those modules rather than duplicating them. The "defaults" test must stay first in this `describe` — no earlier test in the file calls `setRemoteExecutionConfigResolver`.)

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts`
Expected: FAIL — `resolveRemoteExecutionConfig` / `setRemoteExecutionConfigResolver` are not exported.

- [ ] **Step 7: Implement the resolver in `connection-manager.ts`**

In `connection-manager.ts`, change the config import (line 12) to also pull the type:

```typescript
import { DEFAULT_LOCAL_DOCKER_CONFIG, type RemoteExecutionConfig } from "./config.js";
```

Add, immediately before `// Spawns the docker/ssh child ...` (just above `createProductionTransport`):

```typescript
let configResolver: (() => RemoteExecutionConfig) | null = null;

/**
 * Installs the resolver that supplies the live remote-execution config (read
 * from Settings) to createProductionTransport. Called once at orchestrator boot.
 */
export const setRemoteExecutionConfigResolver = (
  fn: () => RemoteExecutionConfig,
): void => {
  configResolver = fn;
};

/** The config the next production transport will use. Defaults to local Docker. */
export const resolveRemoteExecutionConfig = (): RemoteExecutionConfig =>
  configResolver?.() ?? DEFAULT_LOCAL_DOCKER_CONFIG;
```

Change `createProductionTransport` to use it:

```typescript
const createProductionTransport = (): WireTransport => {
  const { command, args } = buildTransportCommand(resolveRemoteExecutionConfig());
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  return new ChildProcessWireTransport(child);
};
```

- [ ] **Step 8: Run the resolver test to verify it passes**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the resolver at orchestrator boot**

In `apps/main/src/ipc/orchestrator-handlers.ts`, add imports near the other adapter imports:

```typescript
import {
  setRemoteExecutionConfigResolver,
} from "../orchestrator/adapters/claude-oauth-remote-docker/connection-manager.js";
import { toRemoteExecutionConfig } from "../orchestrator/adapters/claude-oauth-remote-docker/config.js";
```

Inside `registerOrchestratorHandlers`, just after the repo declarations (after `const inbox = createInboxRepository(db);`, before the `pendingCosts` block), add:

```typescript
  const settingsRepo = createSettingsRepository(db);

  // Remote execution config flows from Settings → the remote-docker transport.
  setRemoteExecutionConfigResolver(() =>
    toRemoteExecutionConfig(settingsRepo.read().remoteExecution),
  );
```

(`createSettingsRepository` is already imported.)

- [ ] **Step 10: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/config.test.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.ts apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/connection-manager.test.ts apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(m10): resolve remote execution config from settings"
```

---

## Task 3: `resolveAdapterCredentials` + `ensureAgentRunner` remote branch

`ensureAgentRunner` currently throws `Unknown adapter` for `claude-oauth-remote-docker`. Extract the adapter-name → credential mapping into a pure, testable function and add the remote-docker branch (it needs the OAuth token, same as `claude-oauth-local`).

**Files:**
- Create: `apps/main/src/orchestrator/adapter-credentials.ts`
- Test: `apps/main/src/orchestrator/adapter-credentials.test.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/orchestrator/adapter-credentials.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveAdapterCredentials } from "./adapter-credentials.js";

const loaders = {
  loadOauthToken: () => "oauth-tok",
  loadApiKey: () => "api-key",
};

describe("resolveAdapterCredentials", () => {
  it("returns the OAuth token for claude-oauth-local", () => {
    expect(resolveAdapterCredentials("claude-oauth-local", loaders)).toEqual({
      oauthToken: "oauth-tok",
    });
  });

  it("returns the OAuth token for claude-oauth-remote-docker", () => {
    expect(resolveAdapterCredentials("claude-oauth-remote-docker", loaders)).toEqual({
      oauthToken: "oauth-tok",
    });
  });

  it("returns the API key for claude-api-key-local", () => {
    expect(resolveAdapterCredentials("claude-api-key-local", loaders)).toEqual({
      apiKey: "api-key",
    });
  });

  it("throws when the OAuth token is not configured", () => {
    expect(() =>
      resolveAdapterCredentials("claude-oauth-remote-docker", {
        ...loaders,
        loadOauthToken: () => null,
      }),
    ).toThrow(/OAuth token not configured/);
  });

  it("throws when the API key is not configured", () => {
    expect(() =>
      resolveAdapterCredentials("claude-api-key-local", {
        ...loaders,
        loadApiKey: () => null,
      }),
    ).toThrow(/API key not configured/);
  });

  it("throws for an unknown adapter name", () => {
    expect(() => resolveAdapterCredentials("bogus-adapter", loaders)).toThrow(
      /Unknown adapter/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapter-credentials.test.ts`
Expected: FAIL — module `./adapter-credentials.js` does not exist.

- [ ] **Step 3: Implement `adapter-credentials.ts`**

Create `apps/main/src/orchestrator/adapter-credentials.ts`:

```typescript
/** Decrypted credentials passed to an agent adapter's SpawnContext. */
export type AdapterCredentials = { oauthToken?: string; apiKey?: string };

/** Loaders the resolver calls to fetch decrypted secrets (db-backed in prod). */
export type CredentialLoaders = {
  loadOauthToken: () => string | null;
  loadApiKey: () => string | null;
};

/**
 * Maps an adapter name to the credential it needs. Both OAuth adapters — local
 * and remote-docker — require the OAuth token; the API-key adapter requires the
 * API key. Throws for an unknown adapter or a missing credential.
 */
export const resolveAdapterCredentials = (
  adapterName: string,
  loaders: CredentialLoaders,
): AdapterCredentials => {
  if (
    adapterName === "claude-oauth-local" ||
    adapterName === "claude-oauth-remote-docker"
  ) {
    const token = loaders.loadOauthToken();
    if (token === null) throw new Error("OAuth token not configured");
    return { oauthToken: token };
  }
  if (adapterName === "claude-api-key-local") {
    const key = loaders.loadApiKey();
    if (key === null) throw new Error("API key not configured");
    return { apiKey: key };
  }
  throw new Error(`Unknown adapter '${adapterName}'`);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main run test src/orchestrator/adapter-credentials.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Wire it into `ensureAgentRunner`**

In `apps/main/src/ipc/orchestrator-handlers.ts`, add the import near the other orchestrator imports:

```typescript
import { resolveAdapterCredentials } from "../orchestrator/adapter-credentials.js";
```

Replace the credential block inside `ensureAgentRunner` (currently the `let oauthToken` / `let apiKey` declarations and the `if / else if / else throw` block) with:

```typescript
    const adapterName = agent.adapterName ?? "claude-oauth-local";
    const { oauthToken, apiKey } = resolveAdapterCredentials(adapterName, {
      loadOauthToken: () => loadDecryptedToken(db),
      loadApiKey: () => loadDecryptedApiKey(db),
    });
```

The downstream `...(oauthToken !== undefined ? { oauthToken } : {})` / `...(apiKey !== undefined ? { apiKey } : {})` spreads in the `ensureAdapter({...})` call are unchanged — `oauthToken` and `apiKey` remain `string | undefined`.

- [ ] **Step 6: Verify typecheck + the main suite still green**

Run: `pnpm typecheck && pnpm --filter @prospero/main run test`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/orchestrator/adapter-credentials.ts apps/main/src/orchestrator/adapter-credentials.test.ts apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(m10): support remote docker adapter in ensure runner"
```

---

## Task 4: Hire `location` — type, schema, picker, handler, cost-label test

Adds an optional `location` to the hire input and a pure `pickAdapterForHire` that turns `location` + global `authMode` into an `AdapterName`. Remote always forces OAuth (there is no `claude-api-key-remote-docker`).

**Files:**
- Modify: `packages/shared/src/types/hire-agent-input.ts`
- Modify: `apps/main/src/schemas/hire-agent-input.ts`
- Create: `apps/main/src/agents/hire-adapter.ts`
- Test: `apps/main/src/agents/hire-adapter.test.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`, `apps/renderer/src/env.d.ts`
- Test: `apps/main/tests/costs.recorder.test.ts`

- [ ] **Step 1: Write the failing test for the picker**

Create `apps/main/src/agents/hire-adapter.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { pickAdapterForHire } from "./hire-adapter.js";

describe("pickAdapterForHire", () => {
  it("defaults to claude-oauth-local for local + oauth", () => {
    expect(pickAdapterForHire("local", "oauth")).toBe("claude-oauth-local");
  });

  it("uses claude-api-key-local for local + api-key", () => {
    expect(pickAdapterForHire("local", "api-key")).toBe("claude-api-key-local");
  });

  it("uses claude-oauth-local when location is undefined + oauth", () => {
    expect(pickAdapterForHire(undefined, "oauth")).toBe("claude-oauth-local");
  });

  it("forces claude-oauth-remote-docker for remote, ignoring api-key auth", () => {
    expect(pickAdapterForHire("remote", "api-key")).toBe("claude-oauth-remote-docker");
    expect(pickAdapterForHire("remote", "oauth")).toBe("claude-oauth-remote-docker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main run test src/agents/hire-adapter.test.ts`
Expected: FAIL — module `./hire-adapter.js` does not exist.

- [ ] **Step 3: Implement `hire-adapter.ts`**

Create `apps/main/src/agents/hire-adapter.ts`:

```typescript
import type { AdapterName, AuthMode } from "@prospero/shared";

/**
 * Picks the adapter for a newly hired agent. Remote always forces OAuth — there
 * is no API-key remote adapter (design §7.3). Local follows the global auth mode.
 */
export const pickAdapterForHire = (
  location: "local" | "remote" | undefined,
  authMode: AuthMode,
): AdapterName => {
  if (location === "remote") return "claude-oauth-remote-docker";
  return authMode === "api-key" ? "claude-api-key-local" : "claude-oauth-local";
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main run test src/agents/hire-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `location` to the hire input type + schema**

In `packages/shared/src/types/hire-agent-input.ts`, change `HireFromUiInput`:

```typescript
export interface HireFromUiInput extends HireAgentInput {
  company_id: string;
  location?: "local" | "remote";
}
```

In `apps/main/src/schemas/hire-agent-input.ts`, change `HIRE_FROM_UI_INPUT_SCHEMA`:

```typescript
export const HIRE_FROM_UI_INPUT_SCHEMA = HIRE_AGENT_INPUT_SCHEMA.extend({
  company_id: z.string().min(1),
  location: z.enum(["local", "remote"]).optional(),
});
```

- [ ] **Step 6: Use the picker in the hire handler**

In `apps/main/src/ipc/orchestrator-handlers.ts`, add the import:

```typescript
import { pickAdapterForHire } from "../agents/hire-adapter.js";
```

In the `IPC.AGENTS_HIRE_FROM_UI` handler, replace:

```typescript
    const adapterName = authMode === "api-key" ? "claude-api-key-local" : "claude-oauth-local";
```

with:

```typescript
    const adapterName = pickAdapterForHire(parsed.location, authMode);
```

- [ ] **Step 7: Add `location` to the `hireFromUi` IPC bridge type**

In `apps/main/src/ipc/preload.ts`, in the `agents.hireFromUi` payload type, add `location` after `role_template_id?: string;`:

```typescript
    hireFromUi: (payload: {
      company_id: string;
      name: string;
      role: string;
      system_prompt: string;
      mode?: "supervised" | "auto";
      reports_to?: string;
      role_template_id?: string;
      location?: "local" | "remote";
    }) => ipcRenderer.invoke(IPC.AGENTS_HIRE_FROM_UI, payload) as Promise<Agent>,
```

In `apps/renderer/src/env.d.ts`, the `agents.hireFromUi` payload type gets the same `location?: "local" | "remote";` field appended after `role_template_id?: string;`.

- [ ] **Step 8: Write the failing cost-label verification test**

In `apps/main/tests/costs.recorder.test.ts`, append inside `describe("createCostRecorder.recordTurn", ...)`:

```typescript
  it("labels the cost row with the agent's adapter (remote docker)", () => {
    const { recorder, companyId, agentId, db } = setup();
    recorder.recordTurn({
      companyId,
      agentId,
      projectId: null,
      issueId: null,
      adapterName: "claude-oauth-remote-docker",
      model: "claude-sonnet-4-6",
      sessionId: null,
      usage: { input: 100, output: 50, cache_creation: 0, cache_read: 0 },
    });
    const row = db.prepare("SELECT adapter_name FROM cost_events").get() as {
      adapter_name: string;
    };
    expect(row.adapter_name).toBe("claude-oauth-remote-docker");
  });
```

- [ ] **Step 9: Run the cost-label test to verify it passes**

Run: `pnpm --filter @prospero/main run test tests/costs.recorder.test.ts`
Expected: PASS — `cost_events.adapter_name` already records whatever `recordTurn` is given (`recordTurn` is called with `agent.adapterName` in the orchestrator, so a remote agent labels its rows `claude-oauth-remote-docker` with no further change — design §7.4).

- [ ] **Step 10: Verify typecheck + suites**

Run: `pnpm typecheck && pnpm --filter @prospero/shared run test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/types/hire-agent-input.ts apps/main/src/schemas/hire-agent-input.ts apps/main/src/agents/hire-adapter.ts apps/main/src/agents/hire-adapter.test.ts apps/main/src/ipc/orchestrator-handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts apps/main/tests/costs.recorder.test.ts
git commit -m "feat(m10): pick remote adapter at agent hire"
```

---

## Task 5: `setAdapterName` repo method + `agents:set-adapter` IPC

Lets the user change an agent's location after hire. Per spec §7.3 this is just a column UPDATE — no restart; the next spawn picks it up.

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Test: `apps/main/tests/agents.adapter-name.test.ts`
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`, `apps/renderer/src/env.d.ts`
- Modify: `apps/renderer/src/stores/agents.ts`

- [ ] **Step 1: Write the failing test for the repo method**

Append to `apps/main/tests/agents.adapter-name.test.ts`:

```typescript
describe("agents.setAdapterName (M10 PR-D)", () => {
  it("updates the adapter_name column", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companies = createCompaniesRepository(db);
    const agents = createAgentsRepository(db);
    const co = companies.create({ name: "Co" });
    const agent = agents.create({
      companyId: co.id,
      name: "Mover",
      role: "Engineer",
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(agent.adapterName).toBe("claude-oauth-local");

    agents.setAdapterName(agent.id, "claude-oauth-remote-docker");

    expect(agents.getById(agent.id)?.adapterName).toBe("claude-oauth-remote-docker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main run test tests/agents.adapter-name.test.ts`
Expected: FAIL — `agents.setAdapterName` is not a function.

- [ ] **Step 3: Implement `setAdapterName` in the repository**

In `apps/main/src/agents/repository.ts`, add to the `AgentsRepository` type (after `setModel`):

```typescript
  setModel(id: string, model: string): void;
  setAdapterName(id: string, adapterName: string): void;
```

Add the implementation to the returned object (after the `setModel` method):

```typescript
    setAdapterName(id, adapterName) {
      db.prepare("UPDATE agents SET adapter_name = ?, updated_at = ? WHERE id = ?").run(
        adapterName,
        Date.now(),
        id,
      );
    },
```

(No `recordActivity` call — adding a new `ActivityAction` to the shared enum is out of scope for PR-D; this is a plain column UPDATE per design §7.3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main run test tests/agents.adapter-name.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the IPC channel**

In `packages/shared/src/ipc-channels.ts`, add after `AGENTS_SET_REPORTS_TO`:

```typescript
  AGENTS_SET_REPORTS_TO: "agents:set-reports-to",
  AGENTS_SET_ADAPTER: "agents:set-adapter",
```

- [ ] **Step 6: Add the IPC handler**

In `apps/main/src/ipc/orchestrator-handlers.ts`, add after the `IPC.AGENTS_SET_REPORTS_TO` handler block:

```typescript
  ipcMain.handle(
    IPC.AGENTS_SET_ADAPTER,
    (_e, payload: { agentId: string; adapterName: string }): { ok: true } => {
      const valid = [
        "claude-oauth-local",
        "claude-api-key-local",
        "claude-oauth-remote-docker",
      ];
      if (!valid.includes(payload.adapterName)) throw new Error("Invalid adapter");
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");
      agents.setAdapterName(payload.agentId, payload.adapterName);
      // No restart: the next spawn reads the new adapter_name (design §7.3).
      broadcast({ kind: "roster-changed", companyId: agent.companyId });
      return { ok: true };
    },
  );
```

- [ ] **Step 7: Add the preload binding + renderer type**

In `apps/main/src/ipc/preload.ts`, in the `agents` object, add after `setReportsTo`:

```typescript
    setAdapter: (agentId: string, adapterName: string) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_ADAPTER, { agentId, adapterName }) as Promise<{
        ok: true;
      }>,
```

In `apps/renderer/src/env.d.ts`, in the `agents` object, add after `setReportsTo`:

```typescript
        setAdapter: (agentId: string, adapterName: string) => Promise<{ ok: true }>;
```

- [ ] **Step 8: Add the store action**

In `apps/renderer/src/stores/agents.ts`, add to the `State` type (after `setReportsTo`):

```typescript
  setReportsTo: (agentId: string, reportsTo: string | null) => Promise<void>;
  setAdapter: (agentId: string, adapterName: string) => Promise<void>;
```

Add the action to the store object (after the `setReportsTo` action):

```typescript
  setAdapter: async (agentId, adapterName) => {
    await window.prospero.agents.setAdapter(agentId, adapterName);
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, adapterName } : a)),
    }));
  },
```

- [ ] **Step 9: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/main/src/agents/repository.ts apps/main/tests/agents.adapter-name.test.ts packages/shared/src/ipc-channels.ts apps/main/src/ipc/orchestrator-handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts apps/renderer/src/stores/agents.ts
git commit -m "feat(m10): add agents set-adapter ipc"
```

---

## Task 6: `testRemoteConnection` + `remote:test-connection` IPC

The Settings "test connection" button opens a throwaway wire connection, performs `handshake` + `health`, and tears the child down. This is launcher glue (spawns Docker/SSH) — not unit-testable on the build machine; verified by the PR-E smoke. Typecheck is the gate here.

**Files:**
- Create: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/test-connection.ts`
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`, `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Implement `test-connection.ts`**

Create `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/test-connection.ts`:

```typescript
import { spawn } from "node:child_process";
import {
  WireClient,
  WIRE_PROTOCOL_VERSION,
  type HandshakeResult,
  type HealthResult,
} from "@prospero/shared";
import { buildTransportCommand } from "./transport-command.js";
import { ChildProcessWireTransport } from "./child-transport.js";
import { resolveRemoteExecutionConfig } from "./connection-manager.js";

export type TestConnectionResult = { ok: boolean; message: string };

const TEST_TIMEOUT_MS = 15_000;

/**
 * Opens a throwaway wire connection (docker run / ssh, per the live Settings
 * config), performs handshake + health, then kills the child. Backs the Settings
 * "test connection" button. The OAuth token sent is the placeholder
 * "connection-test" — the runner only checks kind==="oauth" + non-empty at
 * handshake, so this exercises transport + handshake + health, not auth.
 *
 * Launcher glue: spawns Docker/SSH, so it is not unit-tested — verified by the
 * PR-E smoke checklist.
 */
export const testRemoteConnection = async (): Promise<TestConnectionResult> => {
  const { command, args } = buildTransportCommand(resolveRemoteExecutionConfig());
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const transport = new ChildProcessWireTransport(child);
  const client = new WireClient(transport);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("connection test timed out")),
      TEST_TIMEOUT_MS,
    );
  });
  try {
    const handshake = await Promise.race([
      client.request<HandshakeResult>("handshake", {
        protocolVersion: WIRE_PROTOCOL_VERSION,
        client: "prospero-connection-test",
        clientVersion: "0.0.0",
        credentials: { kind: "oauth", oauthToken: "connection-test" },
      }),
      timeout,
    ]);
    if (handshake.protocolVersion !== WIRE_PROTOCOL_VERSION) {
      return {
        ok: false,
        message: `protocol mismatch: runner speaks ${String(handshake.protocolVersion)}`,
      };
    }
    const health = await Promise.race([
      client.request<HealthResult>("health"),
      timeout,
    ]);
    return {
      ok: health.ok,
      message: health.ok
        ? `runner healthy, ${String(health.activeAgents)} active agent(s)`
        : "runner reported unhealthy",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    child.kill();
  }
};
```

- [ ] **Step 2: Add the IPC channel**

In `packages/shared/src/ipc-channels.ts`, add after `SETTINGS_SET_EXECUTOR_MODE`:

```typescript
  SETTINGS_SET_EXECUTOR_MODE: "settings:set-executor-mode",
  REMOTE_TEST_CONNECTION: "remote:test-connection",
} as const;
```

- [ ] **Step 3: Add the IPC handler**

In `apps/main/src/ipc/orchestrator-handlers.ts`, add the import:

```typescript
import {
  testRemoteConnection,
  type TestConnectionResult,
} from "../orchestrator/adapters/claude-oauth-remote-docker/test-connection.js";
```

Add the handler near the other settings handlers (after the `IPC.SETTINGS_SET_EXECUTOR_MODE` handler):

```typescript
  ipcMain.handle(
    IPC.REMOTE_TEST_CONNECTION,
    (): Promise<TestConnectionResult> => testRemoteConnection(),
  );
```

- [ ] **Step 4: Add the preload binding + renderer type**

In `apps/main/src/ipc/preload.ts`, add a new `remote` object to `window.prospero` (after the `windowControls` object, before the closing `});`):

```typescript
  remote: {
    testConnection: () =>
      ipcRenderer.invoke(IPC.REMOTE_TEST_CONNECTION) as Promise<{
        ok: boolean;
        message: string;
      }>,
  },
```

In `apps/renderer/src/env.d.ts`, add a `remote` object to the `prospero` interface (after `windowControls`):

```typescript
      remote: {
        testConnection: () => Promise<{ ok: boolean; message: string }>;
      };
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/test-connection.ts packages/shared/src/ipc-channels.ts apps/main/src/ipc/orchestrator-handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m10): add remote connection test ipc"
```

---

## Task 7: i18n keys (PT + EN) + parity assertion

Adds the `settings.remoteExecution` and `agent.location` key sets to both locales. The parity test flattens and diffs the full key set, so PT and EN must match exactly.

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`, `apps/renderer/src/i18n/en-US.json`
- Test: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 1: Write the failing parity assertion**

In `apps/renderer/src/i18n/parity.test.ts`, append inside `describe("i18n parity", ...)`:

```typescript
  it("includes the M10 PR-D remote execution keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "settings.remoteExecution.title",
      "settings.remoteExecution.enable",
      "settings.remoteExecution.modeLocal",
      "settings.remoteExecution.modeRemote",
      "settings.remoteExecution.vpsHost",
      "settings.remoteExecution.test",
      "agent.location.label",
      "agent.location.local",
      "agent.location.remote",
      "agent.location.hint",
    ]) {
      expect(ptKeys).toContain(k);
      expect(enKeys).toContain(k);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/renderer run test src/i18n/parity.test.ts`
Expected: FAIL — the new keys are missing in both locales.

- [ ] **Step 3: Add the keys to `pt-BR.json`**

In `apps/renderer/src/i18n/pt-BR.json`, add a `location` object inside the `agent` object (sibling of `config` and `new`):

```json
    "location": {
      "label": "Localização",
      "local": "Local",
      "remote": "Remoto (Docker)",
      "hint": "Onde o processo do agente roda. Remoto exige execução remota habilitada nas Configurações."
    },
```

Add a `remoteExecution` object inside the `settings` object:

```json
    "remoteExecution": {
      "title": "Execução remota",
      "subtitle": "Roda os agentes dentro de um container Docker — local, ou numa VPS via SSH.",
      "enable": "Habilitar execução remota",
      "modeLabel": "Destino",
      "modeLocal": "Docker local",
      "modeRemote": "VPS remota",
      "vpsHost": "Host da VPS",
      "vpsUser": "Usuário SSH",
      "vpsKeyPath": "Caminho da chave SSH",
      "test": "Testar conexão",
      "testing": "Testando…",
      "testOk": "Conexão OK — {{message}}",
      "testFail": "Falha — {{message}}"
    },
```

- [ ] **Step 4: Add the keys to `en-US.json`**

In `apps/renderer/src/i18n/en-US.json`, add a `location` object inside the `agent` object:

```json
    "location": {
      "label": "Location",
      "local": "Local",
      "remote": "Remote (Docker)",
      "hint": "Where the agent process runs. Remote requires remote execution enabled in Settings."
    },
```

Add a `remoteExecution` object inside the `settings` object:

```json
    "remoteExecution": {
      "title": "Remote execution",
      "subtitle": "Runs agents inside a Docker container — local, or on a VPS over SSH.",
      "enable": "Enable remote execution",
      "modeLabel": "Target",
      "modeLocal": "Local Docker",
      "modeRemote": "Remote VPS",
      "vpsHost": "VPS host",
      "vpsUser": "SSH user",
      "vpsKeyPath": "SSH key path",
      "test": "Test connection",
      "testing": "Testing…",
      "testOk": "Connection OK — {{message}}",
      "testFail": "Failed — {{message}}"
    },
```

- [ ] **Step 5: Run the parity test to verify it passes**

Run: `pnpm --filter @prospero/renderer run test src/i18n/parity.test.ts`
Expected: PASS — both the new assertion and `pt-BR and en-US expose the same key set` are green.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m10): add remote execution i18n keys"
```

---

## Task 8: `setRemoteExecution` store action + `RemoteExecutionSection` + Settings.tsx

The Settings section: enable toggle, Local Docker | Remote VPS radio, SSH inputs (shown for VPS), and a "test connection" button. `settings:update` does a shallow merge in the repo, so the store always sends the **complete** `remoteExecution` object — the action merges the patch against current state first.

**Files:**
- Modify: `apps/renderer/src/stores/settings.ts`
- Create: `apps/renderer/src/components/settings/RemoteExecutionSection.tsx`
- Modify: `apps/renderer/src/routes/Settings.tsx`

- [ ] **Step 1: Add the `setRemoteExecution` store action**

In `apps/renderer/src/stores/settings.ts`, extend the type import:

```typescript
import type {
  AppSettings,
  AuthMode,
  ExecutorMode,
  Language,
  RemoteExecutionSettings,
  Theme,
} from "@prospero/shared";
```

Add to the `State` type (after `setAuthMode`):

```typescript
  setAuthMode: (mode: AuthMode) => Promise<void>;
  setRemoteExecution: (patch: Partial<RemoteExecutionSettings>) => Promise<void>;
```

Change the store factory signature to expose `get`:

```typescript
export const useSettingsStore = create<State>((set, get) => ({
```

Add the action (after `setAuthMode`):

```typescript
  setRemoteExecution: async (patch) => {
    const merged = { ...get().settings.remoteExecution, ...patch };
    const next = await window.prospero.settings.update({ remoteExecution: merged });
    set({ settings: next });
  },
```

- [ ] **Step 2: Create the `RemoteExecutionSection` component**

Create `apps/renderer/src/components/settings/RemoteExecutionSection.tsx`:

```typescript
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settings.js";

export const RemoteExecutionSection: FC = () => {
  const { t } = useTranslation();
  const remote = useSettingsStore((s) => s.settings.remoteExecution);
  const setRemoteExecution = useSettingsStore((s) => s.setRemoteExecution);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const onTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.prospero.remote.testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("settings.remoteExecution.title")}
      </h2>
      <p className="text-xs text-ink-muted mb-3">{t("settings.remoteExecution.subtitle")}</p>

      <label className="flex items-start gap-3 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={remote.enabled}
          onChange={(e) => void setRemoteExecution({ enabled: e.target.checked })}
          className="mt-1"
        />
        <span className="text-sm font-medium text-ink">
          {t("settings.remoteExecution.enable")}
        </span>
      </label>

      {remote.enabled && (
        <div className="space-y-3 pl-6 border-l-2 border-surface-border">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              {t("settings.remoteExecution.modeLabel")}
            </label>
            <div className="flex gap-3 text-sm">
              {(["local-docker", "remote-vps"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="remoteExecutionMode"
                    checked={remote.mode === m}
                    onChange={() => void setRemoteExecution({ mode: m })}
                  />
                  {m === "local-docker"
                    ? t("settings.remoteExecution.modeLocal")
                    : t("settings.remoteExecution.modeRemote")}
                </label>
              ))}
            </div>
          </div>

          {remote.mode === "remote-vps" && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  {t("settings.remoteExecution.vpsHost")}
                </label>
                <input
                  type="text"
                  value={remote.vpsHost}
                  onChange={(e) => void setRemoteExecution({ vpsHost: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  {t("settings.remoteExecution.vpsUser")}
                </label>
                <input
                  type="text"
                  value={remote.vpsUser}
                  onChange={(e) => void setRemoteExecution({ vpsUser: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  {t("settings.remoteExecution.vpsKeyPath")}
                </label>
                <input
                  type="text"
                  value={remote.vpsKeyPath}
                  onChange={(e) => void setRemoteExecution({ vpsKeyPath: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
                />
              </div>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => void onTest()}
              disabled={testing}
              className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
            >
              {testing
                ? t("settings.remoteExecution.testing")
                : t("settings.remoteExecution.test")}
            </button>
            {testResult !== null && (
              <p
                className={`mt-2 text-xs ${
                  testResult.ok ? "text-semantic-success" : "text-semantic-danger"
                }`}
              >
                {testResult.ok
                  ? t("settings.remoteExecution.testOk", { message: testResult.message })
                  : t("settings.remoteExecution.testFail", { message: testResult.message })}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
```

- [ ] **Step 2 (cont.): Plug it into `Settings.tsx`**

In `apps/renderer/src/routes/Settings.tsx`, add the import:

```typescript
import { RemoteExecutionSection } from "../components/settings/RemoteExecutionSection.js";
```

Render `<RemoteExecutionSection />` immediately after the executor-mode `</section>` (the one containing `t("settings.executor.title")`) and before the `t("settings.agentDefaults.title")` section.

- [ ] **Step 3: Verify typecheck + lint + renderer suite**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @prospero/renderer run test`
Expected: PASS — no regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/stores/settings.ts apps/renderer/src/components/settings/RemoteExecutionSection.tsx apps/renderer/src/routes/Settings.tsx
git commit -m "feat(m10): add remote execution settings section"
```

---

## Task 9: AgentNew location radio + store `hireFromUi` passthrough

Adds a Local | Remote radio to the hire form. The backend `pickAdapterForHire` already maps `location` + global auth mode to the adapter, so AgentNew only sends `location`.

**Files:**
- Modify: `apps/renderer/src/stores/agents.ts`
- Modify: `apps/renderer/src/routes/AgentNew.tsx`

- [ ] **Step 1: Add `location` to the store's `hireFromUi` payload type**

In `apps/renderer/src/stores/agents.ts`, in the `State` type, add `location` to the `hireFromUi` payload (after `role_template_id?: string;`):

```typescript
  hireFromUi: (payload: {
    company_id: string;
    name: string;
    role: string;
    system_prompt: string;
    mode?: "supervised" | "auto";
    reports_to?: string;
    role_template_id?: string;
    location?: "local" | "remote";
  }) => Promise<Agent>;
```

The `hireFromUi` action body is unchanged — it forwards the whole `payload` to `window.prospero.agents.hireFromUi`, whose type now accepts `location` (Task 4).

- [ ] **Step 2: Add the location radio to `AgentNew.tsx`**

In `apps/renderer/src/routes/AgentNew.tsx`, add a state hook after the `mode` state:

```typescript
  const [mode, setMode] = useState<"supervised" | "auto">(settings.defaultAgentMode);
  const [location, setLocation] = useState<"local" | "remote">("local");
```

In `submit`, pass `location` to `hireFromUi` (add after the `mode,` line in the payload):

```typescript
      const created = await hireFromUi({
        company_id: companyId,
        name: name.trim(),
        role: selected?.name ?? "Agent",
        system_prompt: persona,
        mode,
        location,
        ...(reportsTo !== "" ? { reports_to: reportsTo } : {}),
        ...(roleTemplateId !== "" ? { role_template_id: roleTemplateId } : {}),
      });
```

Add the radio block in the form, after the `mode` field `<div className="mb-3">...</div>` and before the persona field:

```typescript
      <div className="mb-3">
        <label className="block text-xs text-ink-soft mb-1">
          {t("agent.location.label")}
        </label>
        <div className="flex gap-3 text-sm">
          {(["local", "remote"] as const).map((loc) => (
            <label key={loc} className="flex items-center gap-1">
              <input
                type="radio"
                name="location-new"
                checked={location === loc}
                onChange={() => setLocation(loc)}
              />
              {t(`agent.location.${loc}`)}
            </label>
          ))}
        </div>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.location.hint")}</p>
      </div>
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/stores/agents.ts apps/renderer/src/routes/AgentNew.tsx
git commit -m "feat(m10): pick agent location in hire form"
```

---

## Task 10: ConfigTab location selector

Adds a location selector to Agent Studio's Config tab. "Remote" → `claude-oauth-remote-docker`; "Local" → the auth-mode-appropriate local adapter (`claude-api-key-local` if the global auth mode is api-key, else `claude-oauth-local`). Change takes effect on the next spawn (design §7.3).

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`

- [ ] **Step 1: Add the location selector**

In `apps/renderer/src/components/agent-panel/ConfigTab.tsx`, add the imports:

```typescript
import { useSettingsStore } from "../../stores/settings.js";
```

Add the store hooks alongside the other `useAgentsStore` hooks at the top of the component:

```typescript
  const setAdapter = useAgentsStore((s) => s.setAdapter);
  const authMode = useSettingsStore((s) => s.settings.authMode);
```

Add a new `<section>` after the `reportsTo` section and before the `mode` section:

```typescript
      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.location.label")}
        </h3>
        <div className="flex gap-3 text-xs">
          {(["local", "remote"] as const).map((loc) => {
            const isRemote = agent.adapterName === "claude-oauth-remote-docker";
            const current = isRemote ? "remote" : "local";
            return (
              <label key={loc} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`location-${agent.id}`}
                  checked={current === loc}
                  onChange={() => {
                    const adapterName =
                      loc === "remote"
                        ? "claude-oauth-remote-docker"
                        : authMode === "api-key"
                          ? "claude-api-key-local"
                          : "claude-oauth-local";
                    void setAdapter(agent.id, adapterName);
                  }}
                />
                {t(`agent.location.${loc}`)}
              </label>
            );
          })}
        </div>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.location.hint")}</p>
      </section>
```

- [ ] **Step 2: Verify typecheck + lint + renderer suite**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @prospero/renderer run test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/agent-panel/ConfigTab.tsx
git commit -m "feat(m10): edit agent location in agent studio"
```

---

## Task 11: Final verification

**Files:** none — verification only.

- [ ] **Step 1: Run typecheck across all packages**

Run: `pnpm typecheck`
Expected: PASS — clean.

- [ ] **Step 2: Run lint across all packages**

Run: `pnpm lint`
Expected: PASS — clean.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS — baseline was 953 passing + 2 todo; PR-D adds roughly 19 tests (~972 passing). Confirm zero failures and that the count went **up**, not down.

- [ ] **Step 4: Manual sanity check of the new surfaces**

Confirm by reading the diff (no app run required):
- `Settings.tsx` renders `<RemoteExecutionSection />`.
- `AgentNew.tsx` sends `location` in the `hireFromUi` payload.
- `ConfigTab.tsx` renders the location selector.
- `orchestrator-handlers.ts`: `ensureAgentRunner` no longer throws for `claude-oauth-remote-docker`; `setRemoteExecutionConfigResolver` is called at boot; the `agents:set-adapter` and `remote:test-connection` handlers are registered.

- [ ] **Step 5: Commit any final fixes**

If steps 1-3 surfaced issues, fix them and commit:

```bash
git add -A
git commit -m "fix(m10): address pr-d verification findings"
```

---

## Self-Review

**Spec coverage (§7 of the M10 design spec):**
- §7.1 No DB migration — Task 1 extends the `app-settings` JSON blob only. ✓
- §7.2 Settings "Remote execution" section — Task 7 (i18n) + Task 8 (`RemoteExecutionSection`: enable toggle, Local/VPS radio, SSH host/user/keyPath inputs, test button) + Task 6 (test-connection backend). ✓
- §7.3 Per-agent location — Task 4 (hire), Task 5 (`agents:set-adapter`), Task 9 (AgentNew radio), Task 10 (ConfigTab selector). ✓
- §7.4 Cost label — Task 4 Step 8-9 verifies `cost_events.adapter_name` records `claude-oauth-remote-docker`. ✓
- §7.5 i18n PT/EN + parity test — Task 7. ✓
- The blocking `ensureAgentRunner` `Unknown adapter` throw — Task 3. ✓

**Placeholder scan:** No "TBD"/"add appropriate X"/"similar to Task N" — every code step carries complete code; commands carry expected output.

**Type consistency:** `RemoteExecutionSettings`/`RemoteExecutionMode` (shared) used identically in schema, mapper, store, component. `toRemoteExecutionConfig` returns `RemoteExecutionConfig` (PR-C type, unchanged). `resolveAdapterCredentials` returns `{ oauthToken?, apiKey? }` matching the `ensureAdapter` spread. `pickAdapterForHire` returns `AdapterName`. `setAdapterName` (repo) named consistently with `setModel`/`setMode`; store/preload/env.d.ts use `setAdapter` (the IPC-surface name) consistently. `testRemoteConnection` → `TestConnectionResult` used in handler + preload + env.d.ts. IPC channels `AGENTS_SET_ADAPTER`/`REMOTE_TEST_CONNECTION` referenced consistently.

**Note on `setAdapterName`:** unlike sibling repo setters it does not call `recorder.recordActivity` — that would require adding a new `ActivityAction` to the shared enum + a payload schema, which is out of PR-D scope. Plain column UPDATE per design §7.3.
