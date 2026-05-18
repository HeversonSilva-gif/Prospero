# M12 PR-C — Instruction Bundle & Instructions Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every agent a **multi-file instruction bundle** on disk (an editable `charter.md` entry copied from its role, plus user-added extras), wire it into the agent's system prompt, and ship an **Instructions tab** to edit it.

**Architecture:** The bundle is a **directory**, not a DB table (chosen by the user — consistent with PR-A/PR-B). Layout: `userData/agent-instructions/companies/<cid>/agents/<aid>/` with `charter.md` (the entry) + extra `*.md` files. The bundle is **lazily materialized** the first time it is accessed — `charter.md` copied from the role's charter (PR-A's `readCharter`), `persona.md` seeded from the legacy `agent.system_prompt`. A host-side `composeInstructions` reads the bundle, concatenates entry-first, and threads it through `SpawnContext.instructionsBlock` exactly as M11 threads `memoryBlock`; `buildClaudeArgs` feeds it to `composeSystemPrompt` as `agentPersona`, replacing the `agent.system_prompt` string.

**Tech Stack:** Electron + TypeScript, React + zustand + react-i18next, vitest. No migration, no shared-package type changes beyond `SpawnContext`.

**Design decisions (intentional deviations from `docs/m12-agent-org-definition-layer.md` §6):**
- **No `agent_instruction_files` table.** The directory is the single source of truth — `listFiles` = `readdirSync`, add = `writeFileSync`, delete = `unlinkSync`. Eliminates DB↔disk drift. Entry = `charter.md` by convention; extras ordered alphabetically (the user prefixes `01-`, `02-` if order matters). Loses drag-reorder — judged not worth a table.
- **Bundle path under `userData/`**, not `~/.prospero/` — follows the shipped M11 `memory-dir.ts` and PR-A's `role-library-dir.ts`.
- **Lazy materialization, no post-migration.** Existing agents get their bundle the first time `composeInstructions` or the Instructions-tab list IPC runs. No hire-flow changes — lazy ensure covers new hires too.
- **`agent.system_prompt` column kept** as legacy plumbing and as the seed for `persona.md`. Nothing writes it via the UI after this PR (the Persona textarea is removed); the `agents:set-system-prompt` IPC + store action are left in place as dead legacy (removing them ripples for no gain).
- **`composeSystemPrompt` itself is unchanged** — it still takes `agentPersona: string`. The "refactor" is feeding it the bundle from `buildClaudeArgs` instead of `agent.systemPrompt`.

**Targeted test runs:** `pnpm --filter @prospero/main exec vitest run <file>` and `pnpm --filter @prospero/renderer exec vitest run <file>`. Full suite at the end: `pnpm test`.

---

## File Structure

**Created:**
- `apps/main/src/agents/instruction-bundle-dir.ts` — bundle path helpers + `assertSafeFilename` + `ENTRY_FILENAME`.
- `apps/main/src/agents/instruction-bundle-dir.test.ts`
- `apps/main/src/agents/instruction-bundle.ts` — the store: `ensureBundle`, `listFiles`, `readFile`, `writeFile`, `addFile`, `deleteFile`, `composeInstructions`.
- `apps/main/src/agents/instruction-bundle.test.ts`
- `apps/main/src/ipc/instructions-handlers.ts` — 5 IPC handlers.
- `apps/renderer/src/components/agent-panel/InstructionsTab.tsx` — the Instructions tab UI.

**Modified:**
- `packages/shared/src/types/adapter.ts` — `SpawnContext.instructionsBlock?: string`.
- `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts` — `opts.instructionsBlock` → `agentPersona`.
- `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts` — thread `ctx.instructionsBlock`.
- `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.ts` — thread `ctx.instructionsBlock`.
- `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.ts` — thread `ctx.instructionsBlock`.
- `apps/main/src/ipc/orchestrator-handlers.ts` — build `instructionsBlock` at spawn, thread into `ensureAdapter`.
- `apps/main/src/ipc/handlers.ts` — register the instructions handlers.
- `packages/shared/src/ipc-channels.ts` — 5 new channels.
- `apps/main/src/ipc/preload.ts` — `instructions` bridge.
- `apps/renderer/src/env.d.ts` — `instructions` type.
- `apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx` — add the Instructions tab.
- `apps/renderer/src/components/agent-panel/ConfigTab.tsx` — remove the Persona section.
- `apps/renderer/src/i18n/en-US.json` + `pt-BR.json` — `agent.instructions.*` + `agent.panel.tabs.instructions`.

**Deleted:**
- `apps/renderer/src/components/agent-panel/InstructionsFullScreenModal.tsx` — absorbed by the Instructions tab.

---

## Task 1: Bundle path helpers (`instruction-bundle-dir.ts`)

**Files:**
- Create: `apps/main/src/agents/instruction-bundle-dir.ts`
- Create: `apps/main/src/agents/instruction-bundle-dir.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/agents/instruction-bundle-dir.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENTRY_FILENAME,
  getAgentInstructionsDir,
  instructionFilePath,
  assertSafeFilename,
} from "./instruction-bundle-dir.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "prospero-instr-"));

describe("instruction-bundle-dir", () => {
  it("the entry filename is charter.md", () => {
    expect(ENTRY_FILENAME).toBe("charter.md");
  });

  it("getAgentInstructionsDir nests under agent-instructions and creates it", () => {
    const dir = getAgentInstructionsDir(tmp(), "c1", "a1");
    expect(dir.endsWith(join("agent-instructions", "companies", "c1", "agents", "a1"))).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  it("instructionFilePath joins a filename onto the bundle dir", () => {
    const userData = tmp();
    const path = instructionFilePath(userData, "c1", "a1", "charter.md");
    expect(path).toBe(join(getAgentInstructionsDir(userData, "c1", "a1"), "charter.md"));
  });

  it("assertSafeFilename accepts kebab .md names", () => {
    expect(() => assertSafeFilename("charter.md")).not.toThrow();
    expect(() => assertSafeFilename("01-tone.md")).not.toThrow();
  });

  it("assertSafeFilename rejects traversal, subpaths and non-md names", () => {
    expect(() => assertSafeFilename("../escape.md")).toThrow();
    expect(() => assertSafeFilename("sub/file.md")).toThrow();
    expect(() => assertSafeFilename("sub\\file.md")).toThrow();
    expect(() => assertSafeFilename("notes.txt")).toThrow();
    expect(() => assertSafeFilename("")).toThrow();
    expect(() => assertSafeFilename(".md")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/agents/instruction-bundle-dir.test.ts`
Expected: FAIL — `Cannot find module './instruction-bundle-dir.js'`.

- [ ] **Step 3: Create `apps/main/src/agents/instruction-bundle-dir.ts`**

```ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Filesystem layout for per-agent instruction bundles. Mirrors the M11
// memory-dir.ts pattern: everything under app.getPath("userData"). The bundle
// is a plain directory — no DB table — so the filesystem is the single source
// of truth (listFiles = readdir, add = write, delete = unlink).

// The entry file of every bundle. Concatenated first; never deletable.
export const ENTRY_FILENAME = "charter.md";

// Per-agent bundle directory:
//   <userData>/agent-instructions/companies/<companyId>/agents/<agentId>/
// Created on access.
export const getAgentInstructionsDir = (
  userDataDir: string,
  companyId: string,
  agentId: string,
): string => {
  const dir = join(userDataDir, "agent-instructions", "companies", companyId, "agents", agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Rejects any filename that is not a safe, flat, markdown name. All instruction
// filenames are either the fixed entry or user-supplied via the Instructions
// tab, so this is the path-traversal guard for that input.
export const assertSafeFilename = (filename: string): void => {
  if (!/^[a-z0-9][a-z0-9-]*\.md$/i.test(filename)) {
    throw new Error(`unsafe instruction filename: ${JSON.stringify(filename)}`);
  }
};

// Absolute path of one file inside an agent's bundle. Pure — does not create
// directories. Guards the filename before joining.
export const instructionFilePath = (
  userDataDir: string,
  companyId: string,
  agentId: string,
  filename: string,
): string => {
  assertSafeFilename(filename);
  return join(getAgentInstructionsDir(userDataDir, companyId, agentId), filename);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/agents/instruction-bundle-dir.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/instruction-bundle-dir.ts apps/main/src/agents/instruction-bundle-dir.test.ts
git commit -m "feat(instructions): add instruction bundle path helpers"
```

---

## Task 2: The instruction bundle store (`instruction-bundle.ts`)

**Files:**
- Create: `apps/main/src/agents/instruction-bundle.ts`
- Create: `apps/main/src/agents/instruction-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/src/agents/instruction-bundle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@prospero/shared";
import { instructionFilePath } from "./instruction-bundle-dir.js";
import {
  ensureBundle,
  listFiles,
  readFile,
  writeFile,
  addFile,
  deleteFile,
  composeInstructions,
} from "./instruction-bundle.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "prospero-bundle-"));

// Minimal Agent stub — the bundle store only reads id/companyId/templateId/systemPrompt.
const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "a1",
  companyId: "c1",
  name: "Eng",
  role: "engineer",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  ...over,
});

describe("instruction-bundle", () => {
  it("ensureBundle materializes charter.md from the role charter", () => {
    const userData = tmp();
    ensureBundle(userData, agent({ templateId: "role-ceo" }));
    const charter = readFile(userData, agent({ templateId: "role-ceo" }), "charter.md");
    expect(charter.length).toBeGreaterThan(100);
  });

  it("ensureBundle seeds persona.md from a non-empty system_prompt", () => {
    const userData = tmp();
    ensureBundle(userData, agent({ systemPrompt: "Be concise and direct." }));
    expect(readFile(userData, agent(), "persona.md")).toContain("Be concise");
  });

  it("ensureBundle writes no persona.md when system_prompt is empty", () => {
    const userData = tmp();
    ensureBundle(userData, agent({ systemPrompt: "" }));
    expect(existsSync(instructionFilePath(userData, "c1", "a1", "persona.md"))).toBe(false);
  });

  it("ensureBundle is idempotent and does not overwrite edits", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    writeFile(userData, agent(), "charter.md", "# edited charter\n");
    ensureBundle(userData, agent());
    expect(readFile(userData, agent(), "charter.md")).toBe("# edited charter\n");
  });

  it("listFiles returns the entry first, then extras alphabetically", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    addFile(userData, agent(), "02-process.md");
    addFile(userData, agent(), "01-tone.md");
    const files = listFiles(userData, agent());
    expect(files.map((f) => f.filename)).toEqual(["charter.md", "01-tone.md", "02-process.md"]);
    expect(files[0]!.isEntry).toBe(true);
    expect(files[1]!.isEntry).toBe(false);
  });

  it("addFile rejects a duplicate and the reserved entry name", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    addFile(userData, agent(), "notes.md");
    expect(() => addFile(userData, agent(), "notes.md")).toThrow(/exists/i);
    expect(() => addFile(userData, agent(), "charter.md")).toThrow(/exists|reserved/i);
  });

  it("deleteFile removes an extra but refuses the entry", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    addFile(userData, agent(), "notes.md");
    deleteFile(userData, agent(), "notes.md");
    expect(listFiles(userData, agent()).map((f) => f.filename)).toEqual(["charter.md"]);
    expect(() => deleteFile(userData, agent(), "charter.md")).toThrow(/entry|charter/i);
  });

  it("composeInstructions concatenates the entry first, then extras", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    writeFile(userData, agent(), "charter.md", "CHARTER-BODY");
    addFile(userData, agent(), "extra.md");
    writeFile(userData, agent(), "extra.md", "EXTRA-BODY");
    const composed = composeInstructions(userData, agent());
    expect(composed.indexOf("CHARTER-BODY")).toBeLessThan(composed.indexOf("EXTRA-BODY"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run src/agents/instruction-bundle.test.ts`
Expected: FAIL — `Cannot find module './instruction-bundle.js'`.

- [ ] **Step 3: Create `apps/main/src/agents/instruction-bundle.ts`**

```ts
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import type { Agent } from "@prospero/shared";
import { CHARTER_SKELETON } from "@prospero/shared";
import { readCharter } from "./role-charter-store.js";
import {
  ENTRY_FILENAME,
  getAgentInstructionsDir,
  instructionFilePath,
  assertSafeFilename,
} from "./instruction-bundle-dir.js";

// Per-agent instruction bundle — a directory of markdown files. charter.md is
// the entry (copied from the agent's role on first access); persona.md and any
// user-added files are extras. composeInstructions concatenates them into the
// agent's system prompt. The directory is the single source of truth.

export type InstructionFile = { filename: string; isEntry: boolean };

const PERSONA_FILENAME = "persona.md";

// Resolves the markdown body to seed charter.md from. A valid role id uses
// PR-A's charter store; anything else (no role, odd id) falls back to the
// blank 8-section skeleton.
const resolveRoleCharter = (userDataDir: string, templateId: string | null): string => {
  if (templateId !== null && /^role[-_][A-Za-z0-9-]+$/.test(templateId)) {
    return readCharter(userDataDir, templateId);
  }
  return CHARTER_SKELETON;
};

// Materializes the bundle the first time it is accessed: charter.md from the
// role charter, and persona.md from the legacy agent.system_prompt when that
// is non-empty. Idempotent — once charter.md exists, does nothing (so user
// edits are never clobbered).
export const ensureBundle = (userDataDir: string, agent: Agent): void => {
  const entryPath = instructionFilePath(userDataDir, agent.companyId, agent.id, ENTRY_FILENAME);
  if (existsSync(entryPath)) return;
  writeFileSync(entryPath, resolveRoleCharter(userDataDir, agent.templateId), "utf8");
  const persona = agent.systemPrompt.trim();
  if (persona.length > 0) {
    writeFileSync(
      instructionFilePath(userDataDir, agent.companyId, agent.id, PERSONA_FILENAME),
      `${persona}\n`,
      "utf8",
    );
  }
};

// Lists the bundle's files: the entry first, then extras sorted alphabetically.
export const listFiles = (userDataDir: string, agent: Agent): InstructionFile[] => {
  ensureBundle(userDataDir, agent);
  const dir = getAgentInstructionsDir(userDataDir, agent.companyId, agent.id);
  const extras = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== ENTRY_FILENAME)
    .sort((a, b) => a.localeCompare(b));
  return [
    { filename: ENTRY_FILENAME, isEntry: true },
    ...extras.map((filename) => ({ filename, isEntry: false })),
  ];
};

// Reads one file's body.
export const readFile = (userDataDir: string, agent: Agent, filename: string): string => {
  ensureBundle(userDataDir, agent);
  return readFileSync(
    instructionFilePath(userDataDir, agent.companyId, agent.id, filename),
    "utf8",
  );
};

// Writes one file's body (entry or extra).
export const writeFile = (
  userDataDir: string,
  agent: Agent,
  filename: string,
  body: string,
): void => {
  ensureBundle(userDataDir, agent);
  writeFileSync(
    instructionFilePath(userDataDir, agent.companyId, agent.id, filename),
    body,
    "utf8",
  );
};

// Creates a new empty extra file. Rejects the reserved entry name and any
// filename that already exists.
export const addFile = (userDataDir: string, agent: Agent, filename: string): void => {
  ensureBundle(userDataDir, agent);
  assertSafeFilename(filename);
  if (filename === ENTRY_FILENAME) {
    throw new Error(`"${ENTRY_FILENAME}" is the reserved entry file`);
  }
  const path = instructionFilePath(userDataDir, agent.companyId, agent.id, filename);
  if (existsSync(path)) throw new Error(`a file named "${filename}" already exists`);
  writeFileSync(path, `# ${filename.replace(/\.md$/, "")}\n\n`, "utf8");
};

// Deletes an extra file. Refuses the entry.
export const deleteFile = (userDataDir: string, agent: Agent, filename: string): void => {
  assertSafeFilename(filename);
  if (filename === ENTRY_FILENAME) {
    throw new Error(`the entry file "${ENTRY_FILENAME}" cannot be deleted`);
  }
  const path = instructionFilePath(userDataDir, agent.companyId, agent.id, filename);
  if (existsSync(path)) unlinkSync(path);
};

// Concatenates the whole bundle — entry first, extras alphabetically — into the
// single string fed to composeSystemPrompt as the agent persona slot.
export const composeInstructions = (userDataDir: string, agent: Agent): string => {
  return listFiles(userDataDir, agent)
    .map((f) => readFile(userDataDir, agent, f.filename).trim())
    .filter((body) => body.length > 0)
    .join("\n\n");
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run src/agents/instruction-bundle.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/instruction-bundle.ts apps/main/src/agents/instruction-bundle.test.ts
git commit -m "feat(instructions): add the per-agent instruction bundle store"
```

---

## Task 3: Thread the bundle into the system prompt

**Files:**
- Modify: `packages/shared/src/types/adapter.ts`
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts`
- Modify: `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.ts`
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.ts`
- Modify: `apps/main/src/ipc/orchestrator-handlers.ts`

This task is plumbing — verified by `pnpm --filter @prospero/main run typecheck` (Step 7). The bundle logic it carries is already covered by Task 2.

- [ ] **Step 1: Add `instructionsBlock` to `SpawnContext`**

In `packages/shared/src/types/adapter.ts`, inside the `SpawnContext` type, add after the `memoryBlock?: string;` line:

```ts
  // M12 PR-C: pre-assembled instruction bundle (charter + extras), read from
  // the agent's on-disk bundle by the host at spawn time via composeInstructions.
  instructionsBlock?: string;
```

- [ ] **Step 2: Feed `instructionsBlock` to `composeSystemPrompt` in `build-args.ts`**

In `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`, change the `opts` parameter type:

```ts
  opts: { narratedActive?: boolean; memoryBlock?: string } = {},
```

to:

```ts
  opts: { narratedActive?: boolean; memoryBlock?: string; instructionsBlock?: string } = {},
```

and change the `composeSystemPrompt` call's `agentPersona` line:

```ts
      agentPersona: agent.systemPrompt,
```

to:

```ts
      // M12 PR-C: the instruction bundle replaces the legacy system_prompt
      // string. Fall back to system_prompt if the host did not pass a bundle.
      agentPersona: opts.instructionsBlock ?? agent.systemPrompt,
```

- [ ] **Step 3: Thread `ctx.instructionsBlock` in all three adapters**

In each of these three files, find the `buildClaudeArgs(...)` call's options object — it contains a line like `...(this.ctx.memoryBlock !== undefined ? { memoryBlock: this.ctx.memoryBlock } : {}),`. Add a sibling line directly after it:

```ts
      ...(this.ctx.instructionsBlock !== undefined
        ? { instructionsBlock: this.ctx.instructionsBlock }
        : {}),
```

Apply to:
- `apps/main/src/orchestrator/adapters/claude-oauth-local/adapter.ts`
- `apps/main/src/orchestrator/adapters/claude-api-key-local/adapter.ts`
- `apps/main/src/orchestrator/adapters/claude-oauth-remote-docker/adapter.ts`

- [ ] **Step 4: Build the block at spawn in `orchestrator-handlers.ts`**

In `apps/main/src/ipc/orchestrator-handlers.ts`, add an import near the other agent imports at the top of the file:

```ts
import { composeInstructions } from "../agents/instruction-bundle.js";
```

- [ ] **Step 5: Thread it into `ensureAdapter`**

In `apps/main/src/ipc/orchestrator-handlers.ts`, find the `buildMemoryBlock({ ... })` call (assigned to `const memoryBlock`). Immediately after that statement, add:

```ts
    // M12 PR-C: assemble the agent's instruction bundle (charter + extras) from
    // disk — same host-side pattern as buildMemoryBlock.
    const instructionsBlock = composeInstructions(app.getPath("userData"), agent);
```

Then, in the `ensureAdapter({ ... })` call's first argument object, add after the `...(memoryBlock !== undefined ? { memoryBlock } : {}),` line:

```ts
        instructionsBlock,
```

(`composeInstructions` always returns a string — at minimum the charter — so it is passed unconditionally.)

- [ ] **Step 6: Build the shared package is not needed** — `@prospero/shared` is consumed from source. Skip.

- [ ] **Step 7: Typecheck main**

Run: `pnpm --filter @prospero/main run typecheck`
Expected: exits 0.

- [ ] **Step 8: Run the adapter/orchestrator tests to confirm no regression**

Run: `pnpm --filter @prospero/main exec vitest run src/orchestrator`
Expected: PASS — existing build-args / adapter tests still pass (with no `instructionsBlock` passed, `buildClaudeArgs` falls back to `agent.systemPrompt`).

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/types/adapter.ts apps/main/src/orchestrator/adapters apps/main/src/ipc/orchestrator-handlers.ts
git commit -m "feat(instructions): feed the instruction bundle into the system prompt"
```

---

## Task 4: IPC — instruction bundle channels, handlers, preload

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `apps/main/src/ipc/instructions-handlers.ts`
- Modify: `apps/main/src/ipc/handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

Wiring — verified by typecheck (Step 6). The bundle logic is covered by Task 2.

- [ ] **Step 1: Add the 5 IPC channels**

In `packages/shared/src/ipc-channels.ts`, add after the `ROLES_SAVE_CHARTER` line:

```ts
  INSTRUCTIONS_LIST: "instructions:list",
  INSTRUCTIONS_READ: "instructions:read",
  INSTRUCTIONS_WRITE: "instructions:write",
  INSTRUCTIONS_ADD: "instructions:add",
  INSTRUCTIONS_DELETE: "instructions:delete",
```

- [ ] **Step 2: Create `apps/main/src/ipc/instructions-handlers.ts`**

```ts
import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import {
  listFiles,
  readFile,
  writeFile,
  addFile,
  deleteFile,
  type InstructionFile,
} from "../agents/instruction-bundle.js";

export const registerInstructionsHandlers = (db: Database.Database): void => {
  const agents = createAgentsRepository(db);
  const userDataDir = app.getPath("userData");

  const requireAgent = (agentId: string) => {
    const agent = agents.getById(agentId);
    if (agent === null) throw new Error(`agent not found: ${agentId}`);
    return agent;
  };

  ipcMain.handle(
    IPC.INSTRUCTIONS_LIST,
    (_e, payload: { agentId: string }): { files: InstructionFile[] } => {
      return { files: listFiles(userDataDir, requireAgent(payload.agentId)) };
    },
  );

  ipcMain.handle(
    IPC.INSTRUCTIONS_READ,
    (_e, payload: { agentId: string; filename: string }): { body: string } => {
      return { body: readFile(userDataDir, requireAgent(payload.agentId), payload.filename) };
    },
  );

  ipcMain.handle(
    IPC.INSTRUCTIONS_WRITE,
    (_e, payload: { agentId: string; filename: string; body: string }): { ok: true } => {
      writeFile(userDataDir, requireAgent(payload.agentId), payload.filename, payload.body);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.INSTRUCTIONS_ADD,
    (_e, payload: { agentId: string; filename: string }): { ok: true } => {
      addFile(userDataDir, requireAgent(payload.agentId), payload.filename);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.INSTRUCTIONS_DELETE,
    (_e, payload: { agentId: string; filename: string }): { ok: true } => {
      deleteFile(userDataDir, requireAgent(payload.agentId), payload.filename);
      return { ok: true };
    },
  );
};
```

- [ ] **Step 3: Register the handlers in `handlers.ts`**

In `apps/main/src/ipc/handlers.ts`, add the import after the `registerLearningHandlers` import:

```ts
import { registerInstructionsHandlers } from "./instructions-handlers.js";
```

and add the call after `registerLearningHandlers(db);`:

```ts
  registerInstructionsHandlers(db);
```

- [ ] **Step 4: Add the `instructions` bridge to `preload.ts`**

In `apps/main/src/ipc/preload.ts`, add a new bridge object after the `roles: { ... }` block:

```ts
  instructions: {
    list: (agentId: string) =>
      ipcRenderer.invoke(IPC.INSTRUCTIONS_LIST, { agentId }) as Promise<{
        files: Array<{ filename: string; isEntry: boolean }>;
      }>,
    read: (agentId: string, filename: string) =>
      ipcRenderer.invoke(IPC.INSTRUCTIONS_READ, { agentId, filename }) as Promise<{
        body: string;
      }>,
    write: (agentId: string, filename: string, body: string) =>
      ipcRenderer.invoke(IPC.INSTRUCTIONS_WRITE, { agentId, filename, body }) as Promise<{
        ok: true;
      }>,
    add: (agentId: string, filename: string) =>
      ipcRenderer.invoke(IPC.INSTRUCTIONS_ADD, { agentId, filename }) as Promise<{ ok: true }>,
    delete: (agentId: string, filename: string) =>
      ipcRenderer.invoke(IPC.INSTRUCTIONS_DELETE, { agentId, filename }) as Promise<{
        ok: true;
      }>,
  },
```

- [ ] **Step 5: Add the `instructions` type to `env.d.ts`**

In `apps/renderer/src/env.d.ts`, add inside `interface Window`'s `prospero` object, after the `roles: { ... };` block:

```ts
      instructions: {
        list: (agentId: string) => Promise<{
          files: Array<{ filename: string; isEntry: boolean }>;
        }>;
        read: (agentId: string, filename: string) => Promise<{ body: string }>;
        write: (agentId: string, filename: string, body: string) => Promise<{ ok: true }>;
        add: (agentId: string, filename: string) => Promise<{ ok: true }>;
        delete: (agentId: string, filename: string) => Promise<{ ok: true }>;
      };
```

- [ ] **Step 6: Typecheck main + renderer**

Run: `pnpm --filter @prospero/main run typecheck && pnpm --filter @prospero/renderer run typecheck`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/instructions-handlers.ts apps/main/src/ipc/handlers.ts apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(instructions): wire the instruction bundle ipc channels"
```

---

## Task 5: The Instructions tab component

**Files:**
- Create: `apps/renderer/src/components/agent-panel/InstructionsTab.tsx`

No automated test — the repo has no React Testing Library (prior-milestone convention). Verified by typecheck (Step 3) and the Task 8 smoke.

- [ ] **Step 1: Create `apps/renderer/src/components/agent-panel/InstructionsTab.tsx`**

```tsx
import { type FC, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = { agentId: string };

type FileEntry = { filename: string; isEntry: boolean };

export const InstructionsTab: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string>("charter.md");
  const [body, setBody] = useState<string>("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const res = await window.prospero.instructions.list(agentId);
    setFiles(res.files);
  }, [agentId]);

  // Load the file list when the agent changes.
  useEffect(() => {
    setSelected("charter.md");
    void refresh();
  }, [agentId, refresh]);

  // Load the selected file's body.
  useEffect(() => {
    setSavedAt(null);
    setError(null);
    void (async () => {
      const res = await window.prospero.instructions.read(agentId, selected);
      setBody(res.body);
    })();
  }, [agentId, selected]);

  // Debounced save (500ms after the last keystroke).
  useEffect(() => {
    const handle = setTimeout(() => {
      void (async () => {
        try {
          await window.prospero.instructions.write(agentId, selected, body);
          setSavedAt(Date.now());
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 500);
    return () => clearTimeout(handle);
  }, [body, agentId, selected]);

  const onAdd = async (): Promise<void> => {
    const raw = window.prompt(t("agent.instructions.addPrompt"));
    if (raw === null || raw.trim() === "") return;
    let name = raw.trim().toLowerCase();
    if (!name.endsWith(".md")) name += ".md";
    setError(null);
    try {
      await window.prospero.instructions.add(agentId, name);
      await refresh();
      setSelected(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (filename: string): Promise<void> => {
    if (!window.confirm(t("agent.instructions.confirmDelete", { filename }))) return;
    setError(null);
    try {
      await window.prospero.instructions.delete(agentId, filename);
      if (selected === filename) setSelected("charter.md");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="p-4 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold">
          {t("agent.instructions.title")}
        </h3>
        <button
          type="button"
          onClick={() => void onAdd()}
          className="text-[10px] px-2 py-0.5 rounded bg-surface-soft text-ink-muted hover:text-brand"
        >
          {t("agent.instructions.add")}
        </button>
      </div>

      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={f.filename} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSelected(f.filename)}
              className={`flex-1 text-left px-2 py-1 rounded font-mono ${
                selected === f.filename
                  ? "bg-brand-bg text-brand-dark"
                  : "text-ink-muted hover:bg-surface-soft"
              }`}
            >
              {f.filename}
              {f.isEntry && (
                <span className="ml-1 text-[9px] uppercase text-ink-soft">
                  {t("agent.instructions.entryBadge")}
                </span>
              )}
            </button>
            {!f.isEntry && (
              <button
                type="button"
                onClick={() => void onDelete(f.filename)}
                className="text-[10px] text-ink-soft hover:text-rose-600 px-1"
                aria-label={t("agent.instructions.delete")}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSavedAt(null);
        }}
        rows={16}
        className="w-full px-2 py-1.5 border border-surface-border rounded bg-surface text-xs font-mono leading-relaxed resize-y"
      />
      {savedAt !== null && (
        <p className="text-[10px] text-semantic-success">{t("agent.instructions.saved")}</p>
      )}
      {error !== null && <p className="text-[10px] text-semantic-danger">{error}</p>}
      <p className="text-[10px] text-ink-soft">{t("agent.instructions.applyNote")}</p>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck the renderer**

Run: `pnpm --filter @prospero/renderer run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/agent-panel/InstructionsTab.tsx
git commit -m "feat(instructions): add the instructions tab component"
```

---

## Task 6: Wire the tab in, remove the Persona section

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx`
- Modify: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`
- Delete: `apps/renderer/src/components/agent-panel/InstructionsFullScreenModal.tsx`

No automated test — verified by typecheck + lint (Step 4) and the Task 8 smoke.

- [ ] **Step 1: Add the Instructions tab to `AgentConfigPanel.tsx`**

Replace the entire contents of `apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx` with:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@prospero/shared";
import { ConfigTab } from "./ConfigTab.js";
import { InstructionsTab } from "./InstructionsTab.js";
import { IssuesTab } from "./IssuesTab.js";
import { StatsTab } from "./StatsTab.js";

type Tab = "config" | "instructions" | "issues" | "stats";

type Props = { agent: Agent };

export const AgentConfigPanel: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("config");
  return (
    <aside className="w-80 border-l border-surface-border bg-surface-card flex flex-col">
      <nav className="flex border-b border-surface-border">
        {(["config", "instructions", "issues", "stats"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 py-2 text-[11px] font-semibold border-b-2 -mb-px ${
              tab === k
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t(`agent.panel.tabs.${k}`)}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "instructions" && <InstructionsTab agentId={agent.id} />}
        {tab === "issues" && <IssuesTab agentId={agent.id} companyId={agent.companyId} />}
        {tab === "stats" && <StatsTab agentId={agent.id} />}
      </div>
    </aside>
  );
};
```

- [ ] **Step 2: Remove the Persona section from `ConfigTab.tsx`**

Replace the entire contents of `apps/renderer/src/components/agent-panel/ConfigTab.tsx` with (this is the current file with the Persona `<section>`, the `InstructionsFullScreenModal`, the `persona`/`personaSavedAt`/`showInstructionsExpand` state, the persona-save effect, and the now-unused `setSystemPrompt` + `InstructionsFullScreenModal` imports all removed):

```tsx
import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  CLAUDE_MODEL_PRESETS,
  MODEL_ID_REGEX,
  CAPABILITY_CATALOG,
  type Agent,
  type RoleTemplate,
} from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { useProjectsStore } from "../../stores/projects.js";
import { useSettingsStore } from "../../stores/settings.js";
import { AgentProjectsEditor } from "./AgentProjectsEditor.js";
import { ChangeRoleModal } from "./ChangeRoleModal.js";
import { categorizeCapabilities } from "./capabilityCategorize.js";

type Props = { agent: Agent };

export const ConfigTab: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const setModel = useAgentsStore((s) => s.setModel);
  const setRole = useAgentsStore((s) => s.setRole);
  const setReportsTo = useAgentsStore((s) => s.setReportsTo);
  const setMode = useAgentsStore((s) => s.setMode);
  const setAlwaysOn = useAgentsStore((s) => s.setAlwaysOn);
  const setCapabilities = useAgentsStore((s) => s.setCapabilities);
  const wakeUp = useAgentsStore((s) => s.wakeUp);
  const setAdapter = useAgentsStore((s) => s.setAdapter);
  const allAgents = useAgentsStore((s) => s.agents);
  const allProjects = useProjectsStore((s) => s.projects);
  const authMode = useSettingsStore((s) => s.settings.authMode);

  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [modelPreset, setModelPreset] = useState<string>("");
  const [customModel, setCustomModel] = useState<string>("");
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const list = await window.prospero.roles.list();
      setRoles(list);
    })();
  }, []);

  useEffect(() => {
    if ((CLAUDE_MODEL_PRESETS as readonly string[]).includes(agent.model)) {
      setModelPreset(agent.model);
      setCustomModel("");
    } else {
      setModelPreset("custom");
      setCustomModel(agent.model);
    }
  }, [agent.id, agent.model]);

  const currentRole = useMemo(
    () => roles.find((r) => r.id === agent.templateId) ?? null,
    [roles, agent.templateId],
  );

  const otherAgents = useMemo(
    () => allAgents.filter((a) => a.id !== agent.id && a.status !== "terminated"),
    [allAgents, agent.id],
  );

  const allCapabilityIds = useMemo(() => Object.keys(CAPABILITY_CATALOG), []);
  const categorizedCapabilities = useMemo(
    () =>
      categorizeCapabilities({
        agentCapabilities: agent.capabilities,
        roleDefaultCapabilities: currentRole?.defaultCapabilities ?? [],
        allCapabilities: allCapabilityIds,
      }),
    [agent.capabilities, currentRole?.defaultCapabilities, allCapabilityIds],
  );

  const onModelPresetChange = async (v: string): Promise<void> => {
    setModelPreset(v);
    setModelError(null);
    if (v === "custom") return;
    await setModel(agent.id, v);
  };

  const onCustomModelBlur = async (): Promise<void> => {
    const v = customModel.trim();
    if (v === "" || v === agent.model) return;
    if (!MODEL_ID_REGEX.test(v)) {
      setModelError(t("agent.config.model.invalid"));
      return;
    }
    setModelError(null);
    await setModel(agent.id, v);
  };

  return (
    <div className="p-4 space-y-5 text-xs">
      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.role.label")}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-ink font-medium">
            {currentRole !== null ? currentRole.name : agent.role || "—"}
          </span>
          <button
            type="button"
            onClick={() => setShowRoleModal(true)}
            className="text-[10px] px-2 py-0.5 rounded bg-surface-soft text-ink-muted hover:text-brand"
          >
            {t("agent.config.role.change")}
          </button>
        </div>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.config.role.instructionsHint")}</p>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.model.label")}
        </h3>
        <select
          value={modelPreset}
          onChange={(e) => void onModelPresetChange(e.target.value)}
          className="w-full px-2 py-1 border border-surface-border rounded bg-surface text-xs"
        >
          {CLAUDE_MODEL_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="custom">{t("agent.config.model.custom")}</option>
        </select>
        {modelPreset === "custom" && (
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            onBlur={() => void onCustomModelBlur()}
            placeholder="claude-..."
            className="mt-2 w-full px-2 py-1 border border-surface-border rounded bg-surface text-xs font-mono"
          />
        )}
        {modelError !== null && (
          <p className="mt-1 text-[10px] text-semantic-danger">{modelError}</p>
        )}
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.reportsTo.label")}
        </h3>
        <select
          value={agent.reportsTo ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            void setReportsTo(agent.id, v === "" ? null : v);
          }}
          className="w-full px-2 py-1 border border-surface-border rounded bg-surface text-xs"
        >
          <option value="">{t("agent.config.reportsTo.none")}</option>
          {otherAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </section>

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

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.mode.label")}
        </h3>
        <div className="flex gap-3 text-xs">
          {(["supervised", "auto"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name={`mode-${agent.id}`}
                checked={agent.mode === m}
                onChange={() => void setMode(agent.id, m)}
              />
              {t(`agent.config.mode.${m}`)}
            </label>
          ))}
        </div>
      </section>

      <section>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={agent.alwaysOn}
            onChange={(e) => void setAlwaysOn(agent.id, e.target.checked)}
          />
          <span className="text-ink">{t("agent.config.alwaysOn.label")}</span>
        </label>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.config.alwaysOn.hint")}</p>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.schedule.label")}
        </h3>
        <button
          type="button"
          onClick={() => void wakeUp(agent.id)}
          disabled={agent.status === "paused" || agent.status === "terminated"}
          className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded disabled:opacity-50"
        >
          ▶ {t("agent.config.schedule.wakeUp")}
        </button>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.config.schedule.wakeUpHint")}</p>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.capabilities.label")}
        </h3>
        {categorizedCapabilities.required.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
              {t("agent.config.capabilitiesEdit.required")}
            </p>
            {categorizedCapabilities.required.map((s) => (
              <label key={s.id} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={s.enabled} disabled />
                <span>{s.id}</span>
              </label>
            ))}
          </div>
        )}

        {categorizedCapabilities.optional.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
              {t("agent.config.capabilitiesEdit.optional")}
            </p>
            {categorizedCapabilities.optional.map((s) => (
              <label key={s.id} className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...agent.capabilities, s.id]
                      : agent.capabilities.filter((id) => id !== s.id);
                    void setCapabilities(agent.id, next);
                  }}
                />
                <span>{s.id}</span>
              </label>
            ))}
          </div>
        )}

        {categorizedCapabilities.available.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return;
              void setCapabilities(agent.id, [...agent.capabilities, v]);
            }}
            className="text-xs px-2 py-1 border border-surface-border rounded bg-surface w-full mt-1"
          >
            <option value="">{t("agent.config.capabilitiesEdit.addLabel")}</option>
            {categorizedCapabilities.available.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.projects.label")}
        </h3>
        <AgentProjectsEditor agent={agent} allProjects={allProjects} />
      </section>

      {showRoleModal && (
        <ChangeRoleModal
          currentRoleId={agent.templateId}
          onCancel={() => setShowRoleModal(false)}
          onConfirm={async (roleId, preserveModel) => {
            await setRole(agent.id, roleId, { preserveModel });
            setShowRoleModal(false);
          }}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 3: Delete the obsolete modal**

```bash
git rm apps/renderer/src/components/agent-panel/InstructionsFullScreenModal.tsx
```

- [ ] **Step 4: Typecheck and lint the renderer**

Run: `pnpm --filter @prospero/renderer run typecheck && pnpm --filter @prospero/renderer run lint`
Expected: both exit 0. (The `InstructionsFullScreenModal` had no other importers — `ConfigTab` was the only one, and Step 2 removed that import.)

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/components/agent-panel/AgentConfigPanel.tsx apps/renderer/src/components/agent-panel/ConfigTab.tsx
git commit -m "feat(instructions): add the instructions tab and drop the persona textarea"
```

---

## Task 7: i18n keys

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

The `parity.test.ts` enforces that both files have identical key sets — that is this task's check.

- [ ] **Step 1: Inspect the current `agent.instructions` and `agent.panel.tabs` keys**

Run: `grep -n "\"instructions\"\|\"tabs\"\|\"panel\"" apps/renderer/src/i18n/en-US.json`
This locates the existing `agent.instructions` object (used by the now-deleted modal: `modalTitle`, `close`, `applyNote`, `expand`) and the `agent.panel.tabs` object (`config`, `issues`, `stats`).

- [ ] **Step 2: Replace the `agent.panel.tabs` object in both files**

In `apps/renderer/src/i18n/en-US.json`, find the `"tabs"` object under `agent` → `panel` and ensure it reads:

```json
        "tabs": {
          "config": "Config",
          "instructions": "Instructions",
          "issues": "Issues",
          "stats": "Stats"
        }
```

In `apps/renderer/src/i18n/pt-BR.json`, the same object:

```json
        "tabs": {
          "config": "Config",
          "instructions": "Instruções",
          "issues": "Tarefas",
          "stats": "Stats"
        }
```

(Keep whatever the existing `config`/`issues`/`stats` translations are if they differ — only the `instructions` key is new. Match the existing values in each file; the example above shows the expected shape.)

- [ ] **Step 3: Replace the `agent.instructions` object in both files**

In `apps/renderer/src/i18n/en-US.json`, replace the entire `"instructions"` object under `agent` with:

```json
      "instructions": {
        "title": "Instruction files",
        "add": "Add file",
        "addPrompt": "New instruction file name (e.g. tone.md):",
        "delete": "Delete file",
        "confirmDelete": "Delete the instruction file \"{{filename}}\"?",
        "entryBadge": "entry",
        "saved": "Saved",
        "applyNote": "Changes apply on the agent's next turn."
      }
```

In `apps/renderer/src/i18n/pt-BR.json`, replace the entire `"instructions"` object under `agent` with:

```json
      "instructions": {
        "title": "Arquivos de instrução",
        "add": "Adicionar arquivo",
        "addPrompt": "Nome do novo arquivo de instrução (ex.: tom.md):",
        "delete": "Excluir arquivo",
        "confirmDelete": "Excluir o arquivo de instrução \"{{filename}}\"?",
        "entryBadge": "entrada",
        "saved": "Salvo",
        "applyNote": "As mudanças valem a partir do próximo turno do agente."
      }
```

- [ ] **Step 4: Add the `agent.config.role.instructionsHint` key**

`ConfigTab.tsx` (Task 6) references a new `t("agent.config.role.instructionsHint")`. In each file, inside `agent` → `config` → `role`, add the key:

en-US.json:
```json
        "instructionsHint": "Persona and detailed instructions now live in the Instructions tab."
```

pt-BR.json:
```json
        "instructionsHint": "Persona e instruções detalhadas agora ficam na aba Instruções."
```

- [ ] **Step 5: Run the i18n parity test**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS. If it reports a key mismatch, align the two files — the `agent.instructions`, `agent.panel.tabs`, and `agent.config.role` objects must have identical key sets across both files.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(instructions): add i18n keys for the instructions tab"
```

---

## Task 8: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: every package exits 0.

- [ ] **Step 2: Lint the whole workspace**

Run: `pnpm lint`
Expected: every package exits 0.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all packages green. New tests: `instruction-bundle-dir.test.ts` (5) + `instruction-bundle.test.ts` (8). No test was removed. Expect roughly **1252 passing + 2 todo** (baseline 1239 + 13), no regressions.

- [ ] **Step 4: Manual smoke (record the result, do not skip)**

Run `pnpm dev`, open an existing agent:
1. The right panel shows a new **Instructions** tab between Config and Issues.
2. The Instructions tab lists `charter.md` (tagged "entry") and, if that agent had a non-empty persona, `persona.md`.
3. Editing `charter.md` and waiting ~1s shows "Saved"; reopening the tab shows the edit persisted.
4. "Add file" creates a new file; it appears in the list and is editable; deleting it works; `charter.md` has no delete button.
5. The Config tab no longer has a Persona textarea.
6. Confirm the on-disk bundle exists: `<userData>/agent-instructions/companies/<cid>/agents/<aid>/charter.md`.
7. Send the agent a message — it spawns without error (the instruction bundle is now its persona slot).

Record the smoke result in the commit/PR notes. (Per project convention this is the owner's call — do not block on it.)

- [ ] **Step 5: Final commit (only if smoke surfaced fixes)**

```bash
git add -A
git commit -m "fix(instructions): address smoke-test findings"
```

---

## Self-Review Notes

- **Spec coverage (M12 §13 PR-C):** "`agent_instruction_files`" → replaced by the directory-only bundle (Tasks 1-2), per the user's planning-time choice. "bundle gerenciado em disco" → Tasks 1-2. "refactor de `composeSystemPrompt`" → Task 3 (the bundle is fed in via `buildClaudeArgs`; `composeSystemPrompt`'s own signature is unchanged — minimal-risk). "aba Instructions (file-tree + editor)" → Tasks 5-6 (a compact stacked layout in the 320px side panel; the §11 six-tab IA is PR-F's job). Migration of `agent.system_prompt` → handled by lazy `ensureBundle` seeding `persona.md` (Task 2), not a post-migration.
- **Out of scope:** the §11 tab-IA consolidation (PR-F), Runs/Budget/Run Policy (PR-E), the CEO org architect (PR-D).
- **Type consistency:** `InstructionFile` (`{ filename, isEntry }`) is defined in `instruction-bundle.ts` (Task 2) and the IPC/preload/`env.d.ts` payloads (Task 4) use the identical `{ filename: string; isEntry: boolean }` shape; the renderer component (Task 5) re-declares the same shape locally. `composeInstructions`, `ensureBundle`, `listFiles`, `readFile`, `writeFile`, `addFile`, `deleteFile` names are consistent across Tasks 2, 3, 4. `ENTRY_FILENAME` = `"charter.md"` is used consistently.
- **Legacy left in place (intentional):** `agent.system_prompt` column, the `agents:set-system-prompt` IPC, and the `setSystemPrompt` store action remain — unused by the UI after this PR but harmless. Removing them is deferred cleanup.
- **No placeholder scan hits.** Every code step shows complete code.
