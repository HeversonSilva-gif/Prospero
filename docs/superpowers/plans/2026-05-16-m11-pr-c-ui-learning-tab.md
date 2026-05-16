# M11 PR-C-UI — Learning tab + IPC + header badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the M11 memory & skills data in the renderer — a third "Learning" tab on `/agents/:id` with Skills / Memory / History sub-tabs, the IPC handlers that feed it, and a header badge that links to it.

**Architecture:** Four read-only IPC handlers (`learning-handlers.ts`) wrap the PR-B repositories (`skills-repository`, `memories-repository`) and a direct FTS5 query over `messages_fts`. A new `window.prospero.learning` preload namespace exposes them. `Agent.tsx` fetches the agent's skills + memories once per agent (and on re-entering the tab), passes counts to `AgentHeader` for the badge and the lists to a new `LearningPanel` component. The panel reads skill bodies (`SKILL.md` files) and runs session searches lazily.

**Tech Stack:** TypeScript, Electron IPC, better-sqlite3, FTS5, React, react-i18next, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md` §10, §11 PR-C.

## Decisions locked for this plan

- **PR-C-UI is read-only.** The Learning tab *displays* skills, memory entries, and session-search results. It ships **no** mutating UI — no edit, no trust thumbs, no promote button. Those belong to later PRs: `skill_promote` + promotion modal → **PR-E**; trust feedback ±0.05/−0.10 + memory edit → **PR-F**; the **Candidates** sub-tab + Accept/Edit/Reject → **PR-D** (it has no data to show until the derivation pipeline exists). PR-C-UI ships **3** sub-tabs (Skills / Memory / History), matching spec §11 PR-C exactly.
- **Agent memory is DB rows, not a `memory.md` file.** Spec §10 says the Memory sub-tab shows "the agent's `memory.md`", but PR-C backend stores declarative memory as `memories` table rows (`buildMemoryBlock` renders `memoriesRepo.listByAgent`, and only `user.md` is a file). The Memory sub-tab therefore lists `memories` rows grouped by `kind` — this matches what actually ships and what the agent's system prompt actually contains.
- **Four IPC channels, one preload namespace.** `skills:list-for-agent`, `skills:read-body`, `memories:list-for-agent`, `session:search`, all under `window.prospero.learning`.
- **`session:search` is agent-scoped by thread participants.** `messages_fts` is `(message_id, content)` — no `agent_id` column (PR-B). The handler joins `messages → threads` and filters `threads.participants_json LIKE '%<agentId>%'`. Agent ids are long unique strings, so a substring match is delimiter-agnostic and collision-free. Raw user input is turned into a safe FTS5 expression by `toFtsMatchExpr` (each whitespace term quoted → implicit AND), so special characters never crash the `MATCH`.
- **The handler factory is synchronous.** `ipcRenderer.invoke` always returns a Promise regardless, so the factory methods return plain values (matching the read-only nature); only the renderer-facing types are `Promise<...>`.
- **No live updates for the Learning tab.** Skills/memories are fetched on agent change and re-fetched each time the user opens the Learning tab. No event subscription — the panel is informational and a tab switch is a natural refresh point.

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/types/memory.ts` (modify) | add the `SessionSearchHit` type |
| `packages/shared/src/ipc-channels.ts` (modify) | add the 4 new channel constants |
| `packages/shared/tests/ipc-channels.test.ts` (modify) | assert the 4 new channels |
| `apps/main/src/ipc/learning-handlers.ts` | the 4 IPC handlers + `toFtsMatchExpr` |
| `apps/main/tests/ipc.learning-handlers.test.ts` | handler + helper tests |
| `apps/main/src/ipc/handlers.ts` (modify) | register the learning handlers |
| `apps/main/src/ipc/preload.ts` (modify) | `learning` bridge namespace |
| `apps/renderer/src/env.d.ts` (modify) | `learning` typed surface |
| `apps/renderer/src/i18n/pt-BR.json` (modify) | learning keys (PT) |
| `apps/renderer/src/i18n/en-US.json` (modify) | learning keys (EN) |
| `apps/renderer/src/i18n/parity.test.ts` (modify) | M11 learning parity check |
| `apps/renderer/src/components/agent-panel/LearningPanel.tsx` | the Learning tab content (3 sub-tabs) |
| `apps/renderer/src/routes/Agent.tsx` (modify) | 3rd tab + fetch skills/memories + wire badge |
| `apps/renderer/src/components/agent-panel/AgentHeader.tsx` (modify) | the `🎓 N · K` badge |

Dependencies: Task 1 is independent. Task 2 depends on Task 1. Task 3 depends on Tasks 1-2. Task 4 is independent. Task 5 depends on Tasks 3-4. Task 6 depends on Task 5.

---

## Task 1: Shared `SessionSearchHit` type + IPC channels

The renderer and main process both need a type for a session-search result, and four new IPC channel constants.

**Files:**
- Modify: `packages/shared/src/types/memory.ts`
- Modify: `packages/shared/src/ipc-channels.ts`
- Modify: `packages/shared/tests/ipc-channels.test.ts`

- [ ] **Step 1: Write the failing channel test**

In `packages/shared/tests/ipc-channels.test.ts`, add this `it` block inside the `describe("IPC channels", ...)` block, after the "M7 PR-C agent mutation channels" test:

```typescript
  it("exposes the M11 learning channels", () => {
    expect(IPC.SKILLS_LIST_FOR_AGENT).toBe("skills:list-for-agent");
    expect(IPC.SKILLS_READ_BODY).toBe("skills:read-body");
    expect(IPC.MEMORIES_LIST_FOR_AGENT).toBe("memories:list-for-agent");
    expect(IPC.SESSION_SEARCH).toBe("session:search");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/shared test`
Expected: FAIL — `IPC.SKILLS_LIST_FOR_AGENT` is `undefined`.

- [ ] **Step 3: Add the channel constants**

In `packages/shared/src/ipc-channels.ts`, add these four lines inside the `IPC` object literal, immediately before the closing `} as const;` (after `REMOTE_TEST_CONNECTION`):

```typescript
  SKILLS_LIST_FOR_AGENT: "skills:list-for-agent",
  SKILLS_READ_BODY: "skills:read-body",
  MEMORIES_LIST_FOR_AGENT: "memories:list-for-agent",
  SESSION_SEARCH: "session:search",
```

- [ ] **Step 4: Add the `SessionSearchHit` type**

In `packages/shared/src/types/memory.ts`, append this type at the end of the file:

```typescript
// A single full-text match from session_search — one past message the agent
// participated in. Returned by the learning IPC + the session_search MCP tool.
export type SessionSearchHit = {
  messageId: string;
  content: string;
  createdAt: number;
  senderKind: string;
  senderId: string | null;
};
```

- [ ] **Step 5: Run the shared tests + typecheck**

Run: `pnpm --filter @prospero/shared test`
Expected: PASS — including the new channel test and the existing "channel names are unique" / "lowercase-kebab-case" tests (the 4 new values are unique and well-formed).

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/memory.ts packages/shared/src/ipc-channels.ts packages/shared/tests/ipc-channels.test.ts
git commit -m "feat(m11): add learning ipc channels and session-search type"
```

---

## Task 2: `learning-handlers.ts` — the 4 IPC handlers

A new handler module wraps the PR-B repositories. The factory `learningHandlers(db)` returns four synchronous methods; `registerLearningHandlers(db)` wires them to `ipcMain`. Tested directly against the factory with an in-memory DB — no Electron mocking — mirroring `apps/main/tests/ipc.goals-handlers.test.ts`.

**Files:**
- Create: `apps/main/src/ipc/learning-handlers.ts`
- Create: `apps/main/tests/ipc.learning-handlers.test.ts`
- Modify: `apps/main/src/ipc/handlers.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/main/tests/ipc.learning-handlers.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../src/db/migrations.js";
import { createSkillsRepository } from "../src/memory/skills-repository.js";
import { createMemoriesRepository } from "../src/memory/memories-repository.js";
import { learningHandlers, toFtsMatchExpr } from "../src/ipc/learning-handlers.js";

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  return db;
};

describe("toFtsMatchExpr", () => {
  it("quotes a single term", () => {
    expect(toFtsMatchExpr("redis")).toBe('"redis"');
  });
  it("quotes every whitespace-separated term (implicit AND)", () => {
    expect(toFtsMatchExpr("redis outage")).toBe('"redis" "outage"');
  });
  it("escapes embedded double quotes", () => {
    expect(toFtsMatchExpr('say "hi"')).toBe('"say" """hi"""');
  });
  it("returns an empty string for blank input", () => {
    expect(toFtsMatchExpr("   ")).toBe("");
  });
});

describe("learningHandlers", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
  });

  it("listSkills returns the agent's private skills and company-shared skills", () => {
    const repo = createSkillsRepository(db);
    repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath: "p1",
      description: "private deploy skill",
      source: "agent_created",
    });
    repo.create({
      companyId: "c1",
      agentId: null,
      name: "code-review",
      bodyPath: "p2",
      description: "shared review skill",
      source: "user_authored",
    });
    const skills = learningHandlers(db).listSkills({ agentId: "a1" });
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["code-review", "deploy"]);
    expect(skills.find((s) => s.name === "code-review")?.agentId).toBeNull();
  });

  it("listSkills returns [] for an unknown agent", () => {
    expect(learningHandlers(db).listSkills({ agentId: "nope" })).toEqual([]);
  });

  it("readSkillBody returns the SKILL.md file content", () => {
    const dir = mkdtempSync(join(tmpdir(), "prospero-lh-"));
    const bodyPath = join(dir, "SKILL.md");
    writeFileSync(bodyPath, "# Deploy\n1. build\n2. ship", "utf8");
    const skill = createSkillsRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath,
      description: "d",
      source: "agent_created",
    });
    const out = learningHandlers(db).readSkillBody({ skillId: skill.id });
    expect(out.body).toContain("2. ship");
    rmSync(dir, { recursive: true, force: true });
  });

  it("readSkillBody throws for an unknown skill id", () => {
    expect(() => learningHandlers(db).readSkillBody({ skillId: "skill_missing" })).toThrow(
      /not found/i,
    );
  });

  it("listMemories returns the agent's memory rows", () => {
    createMemoriesRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "always lint before commit",
    });
    const memories = learningHandlers(db).listMemories({ agentId: "a1" });
    expect(memories).toHaveLength(1);
    expect(memories[0]?.body).toBe("always lint before commit");
  });

  it("searchSessions finds an agent's past messages by keyword", () => {
    db.prepare(
      "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES ('t1','c1','user|a1',0)",
    ).run();
    db.prepare(
      `INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, kind, tool_calls_json, created_at)
       VALUES ('m1','t1','user',NULL,'investigate the redis outage','message',NULL,10)`,
    ).run();
    db.prepare(
      "INSERT INTO messages_fts (message_id, content) VALUES ('m1','investigate the redis outage')",
    ).run();
    const hits = learningHandlers(db).searchSessions({ agentId: "a1", query: "redis" });
    expect(hits.map((h) => h.messageId)).toEqual(["m1"]);
    expect(hits[0]?.senderKind).toBe("user");
  });

  it("searchSessions excludes messages from threads the agent is not in", () => {
    db.prepare(
      "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES ('t2','c1','user|other',0)",
    ).run();
    db.prepare(
      `INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, kind, tool_calls_json, created_at)
       VALUES ('m2','t2','user',NULL,'unrelated redis chatter','message',NULL,10)`,
    ).run();
    db.prepare(
      "INSERT INTO messages_fts (message_id, content) VALUES ('m2','unrelated redis chatter')",
    ).run();
    expect(learningHandlers(db).searchSessions({ agentId: "a1", query: "redis" })).toEqual([]);
  });

  it("searchSessions returns [] for a blank query", () => {
    expect(learningHandlers(db).searchSessions({ agentId: "a1", query: "  " })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: FAIL — module `../src/ipc/learning-handlers.js` not found.

- [ ] **Step 3: Create `learning-handlers.ts`**

Create `apps/main/src/ipc/learning-handlers.ts`:

```typescript
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { IPC } from "@prospero/shared";
import type { Skill, Memory, SessionSearchHit } from "@prospero/shared";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";

// Turns raw search-box input into a safe FTS5 MATCH expression: each
// whitespace-separated term is wrapped in double quotes (so special characters
// can never break the query), and the quoted terms are joined by spaces, which
// FTS5 reads as an implicit AND. Returns "" for blank input.
export const toFtsMatchExpr = (query: string): string => {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" ");
};

export type LearningHandlers = {
  // Private skills of the agent + the company-shared skills it inherits.
  listSkills(args: { agentId: string }): Skill[];
  // Full SKILL.md body of one skill. Throws if the skill or file is missing.
  readSkillBody(args: { skillId: string }): { body: string };
  // The agent's declarative memory rows.
  listMemories(args: { agentId: string }): Memory[];
  // FTS5 search over the agent's past messages.
  searchSessions(args: { agentId: string; query: string; limit?: number }): SessionSearchHit[];
};

type SessionRow = {
  message_id: string;
  content: string;
  created_at: number;
  sender_kind: string;
  sender_id: string | null;
};

export const learningHandlers = (db: Database.Database): LearningHandlers => {
  const skillsRepo = createSkillsRepository(db);
  const memoriesRepo = createMemoriesRepository(db);
  const companyOfAgent = db.prepare("SELECT company_id FROM agents WHERE id = ?");
  const searchStmt = db.prepare(
    `SELECT m.id AS message_id, m.content AS content, m.created_at AS created_at,
            m.sender_kind AS sender_kind, m.sender_id AS sender_id
       FROM messages_fts f
       JOIN messages m ON m.id = f.message_id
       JOIN threads t ON t.id = m.thread_id
      WHERE messages_fts MATCH ?
        AND t.participants_json LIKE '%' || ? || '%'
      ORDER BY rank
      LIMIT ?`,
  );

  return {
    listSkills({ agentId }) {
      const row = companyOfAgent.get(agentId) as { company_id: string } | undefined;
      if (row === undefined) return [];
      return [...skillsRepo.listByAgent(agentId), ...skillsRepo.listCompanyShared(row.company_id)];
    },

    readSkillBody({ skillId }) {
      const skill = skillsRepo.getById(skillId);
      if (skill === null) throw new Error(`skill not found: ${skillId}`);
      return { body: readFileSync(skill.bodyPath, "utf8") };
    },

    listMemories({ agentId }) {
      return memoriesRepo.listByAgent(agentId);
    },

    searchSessions({ agentId, query, limit }) {
      const expr = toFtsMatchExpr(query);
      if (expr === "") return [];
      const rows = searchStmt.all(expr, agentId, limit ?? 50) as SessionRow[];
      return rows.map((r) => ({
        messageId: r.message_id,
        content: r.content,
        createdAt: r.created_at,
        senderKind: r.sender_kind,
        senderId: r.sender_id,
      }));
    },
  };
};

export const registerLearningHandlers = (db: Database.Database): void => {
  const h = learningHandlers(db);
  ipcMain.handle(IPC.SKILLS_LIST_FOR_AGENT, (_e, args: { agentId: string }) => h.listSkills(args));
  ipcMain.handle(IPC.SKILLS_READ_BODY, (_e, args: { skillId: string }) => h.readSkillBody(args));
  ipcMain.handle(IPC.MEMORIES_LIST_FOR_AGENT, (_e, args: { agentId: string }) =>
    h.listMemories(args),
  );
  ipcMain.handle(
    IPC.SESSION_SEARCH,
    (_e, args: { agentId: string; query: string; limit?: number }) => h.searchSessions(args),
  );
};
```

- [ ] **Step 4: Register the handlers**

In `apps/main/src/ipc/handlers.ts`, add the import after the `registerAgentsMdHandlers` import:

```typescript
import { registerLearningHandlers } from "./learning-handlers.js";
```

And add the registration call at the end of `registerIpcHandlers`, after `registerAgentsMdHandlers(db);`:

```typescript
  registerLearningHandlers(db);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run tests/ipc.learning-handlers.test.ts`
Expected: PASS — 4 `toFtsMatchExpr` tests + 8 `learningHandlers` tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/ipc/learning-handlers.ts apps/main/tests/ipc.learning-handlers.test.ts apps/main/src/ipc/handlers.ts
git commit -m "feat(m11): add learning ipc handlers"
```

---

## Task 3: Preload bridge + renderer typed surface

Expose the four handlers as `window.prospero.learning`.

**Files:**
- Modify: `apps/main/src/ipc/preload.ts`
- Modify: `apps/renderer/src/env.d.ts`

- [ ] **Step 1: Add the `Skill` / `Memory` / `SessionSearchHit` imports to the preload**

In `apps/main/src/ipc/preload.ts`, add these three lines to the `import { ... } from "@prospero/shared"` block (after `type ExecutePlanResult,`):

```typescript
  type Skill,
  type Memory,
  type SessionSearchHit,
```

- [ ] **Step 2: Add the `learning` namespace to the preload bridge**

In `apps/main/src/ipc/preload.ts`, add this namespace inside the `exposeInMainWorld("prospero", { ... })` object, immediately after the `remote: { ... },` block:

```typescript
  learning: {
    listSkills: (agentId: string) =>
      ipcRenderer.invoke(IPC.SKILLS_LIST_FOR_AGENT, { agentId }) as Promise<Skill[]>,
    readSkillBody: (skillId: string) =>
      ipcRenderer.invoke(IPC.SKILLS_READ_BODY, { skillId }) as Promise<{ body: string }>,
    listMemories: (agentId: string) =>
      ipcRenderer.invoke(IPC.MEMORIES_LIST_FOR_AGENT, { agentId }) as Promise<Memory[]>,
    searchSessions: (agentId: string, query: string, limit?: number) =>
      ipcRenderer.invoke(IPC.SESSION_SEARCH, { agentId, query, limit }) as Promise<
        SessionSearchHit[]
      >,
  },
```

- [ ] **Step 3: Add the `learning` typed surface to `env.d.ts`**

In `apps/renderer/src/env.d.ts`, add these three lines to the `import type { ... } from "@prospero/shared"` block (after `ExecutePlanResult,`):

```typescript
  Skill,
  Memory,
  SessionSearchHit,
```

Then add this block inside the `prospero: { ... }` interface, immediately after the `remote: { ... };` block:

```typescript
      learning: {
        listSkills: (agentId: string) => Promise<Skill[]>;
        readSkillBody: (skillId: string) => Promise<{ body: string }>;
        listMemories: (agentId: string) => Promise<Memory[]>;
        searchSessions: (
          agentId: string,
          query: string,
          limit?: number,
        ) => Promise<SessionSearchHit[]>;
      };
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — `window.prospero.learning` is now typed across the renderer.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/ipc/preload.ts apps/renderer/src/env.d.ts
git commit -m "feat(m11): expose learning bridge on window.prospero"
```

---

## Task 4: i18n keys for the Learning tab

Add the `agent.tabs.learning` label and the `agent.learning.*` namespace to both locales, then extend the parity test.

**Files:**
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/parity.test.ts`

- [ ] **Step 1: Add the parity check (failing test first)**

In `apps/renderer/src/i18n/parity.test.ts`, add this `it` block at the end of the `describe("i18n parity", ...)` block (before its closing `});`):

```typescript
  it("includes the M11 PR-C learning keys in both locales", () => {
    const ptKeys = flatten(ptBR);
    const enKeys = flatten(enUS);
    for (const k of [
      "agent.tabs.learning",
      "agent.learning.badgeTitle",
      "agent.learning.subtabs.skills",
      "agent.learning.subtabs.memory",
      "agent.learning.subtabs.history",
      "agent.learning.skills.empty",
      "agent.learning.memory.empty",
      "agent.learning.memory.kind.retrospective",
      "agent.learning.history.prompt",
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

In `apps/renderer/src/i18n/pt-BR.json`, change the `agent.tabs` object to add the `learning` label:

```json
  "tabs": {
   "chat": "Chat",
   "delegations": "Delegações",
   "learning": "Aprendizado"
  },
```

Then add this `learning` block inside the `agent` object, immediately after the `tabs` object (insert a comma after the `tabs` closing brace):

```json
  "learning": {
   "badgeTitle": "Skills e memória deste agente",
   "subtabs": {
    "skills": "Skills",
    "memory": "Memória",
    "history": "Histórico"
   },
   "skills": {
    "empty": "Nenhum skill ainda.",
    "shared": "Compartilhado",
    "usesTitle": "Vezes usado",
    "trustTitle": "Confiança",
    "bodyError": "Não foi possível carregar o corpo do skill."
   },
   "memory": {
    "empty": "Nenhuma memória ainda.",
    "kind": {
     "identity": "Identidade",
     "rule": "Regra",
     "preference": "Preferência",
     "retrospective": "Retrospectiva"
    }
   },
   "history": {
    "placeholder": "Buscar nas conversas passadas...",
    "search": "Buscar",
    "searching": "Buscando...",
    "prompt": "Busque no histórico de conversas deste agente.",
    "empty": "Nenhum resultado para essa busca."
   }
  },
```

- [ ] **Step 4: Add the keys to `en-US.json`**

In `apps/renderer/src/i18n/en-US.json`, change the `agent.tabs` object to add the `learning` label:

```json
  "tabs": {
   "chat": "Chat",
   "delegations": "Delegations",
   "learning": "Learning"
  },
```

Then add this `learning` block inside the `agent` object, immediately after the `tabs` object (insert a comma after the `tabs` closing brace):

```json
  "learning": {
   "badgeTitle": "This agent's skills and memory",
   "subtabs": {
    "skills": "Skills",
    "memory": "Memory",
    "history": "History"
   },
   "skills": {
    "empty": "No skills yet.",
    "shared": "Shared",
    "usesTitle": "Times used",
    "trustTitle": "Trust",
    "bodyError": "Could not load the skill body."
   },
   "memory": {
    "empty": "No memory yet.",
    "kind": {
     "identity": "Identity",
     "rule": "Rule",
     "preference": "Preference",
     "retrospective": "Retrospective"
    }
   },
   "history": {
    "placeholder": "Search past conversations...",
    "search": "Search",
    "searching": "Searching...",
    "prompt": "Search this agent's conversation history.",
    "empty": "No results for that search."
   }
  },
```

> Match the file's existing indentation (these files use 1-space indent). If the pre-commit formatter (prettier) reformats them, that is expected — let it.

- [ ] **Step 5: Run the parity test to verify it passes**

Run: `pnpm --filter @prospero/renderer exec vitest run src/i18n/parity.test.ts`
Expected: PASS — including the "pt-BR and en-US expose the same key set" test (both locales got the identical key set) and the new M11 check.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/i18n/pt-BR.json apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/parity.test.ts
git commit -m "feat(m11): add learning tab i18n keys"
```

---

## Task 5: `LearningPanel` component

The Learning tab content: a sub-tab bar (Skills / Memory / History) and the three views. Skills and Memory render data passed as props; History runs searches lazily via IPC. No component test — this matches the repo convention (sibling `DelegationsPanel` has none; renderer tests cover pure lib helpers only).

**Files:**
- Create: `apps/renderer/src/components/agent-panel/LearningPanel.tsx`

- [ ] **Step 1: Create the component**

Create `apps/renderer/src/components/agent-panel/LearningPanel.tsx`:

```tsx
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Skill, Memory, SessionSearchHit } from "@prospero/shared";

interface Props {
  agentId: string;
  skills: Skill[];
  memories: Memory[];
}

type SubTab = "skills" | "memory" | "history";

const SUB_TABS: SubTab[] = ["skills", "memory", "history"];

export const LearningPanel: FC<Props> = ({ agentId, skills, memories }) => {
  const { t } = useTranslation();
  const [sub, setSub] = useState<SubTab>("skills");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex gap-1 px-6 py-2 border-b border-surface-border">
        {SUB_TABS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSub(s)}
            className={`px-2.5 py-1 text-xs font-medium rounded ${
              sub === s
                ? "bg-brand text-brand-fg"
                : "bg-surface-soft text-ink-muted hover:bg-surface-border"
            }`}
          >
            {t(`agent.learning.subtabs.${s}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {sub === "skills" && <SkillsView skills={skills} />}
        {sub === "memory" && <MemoryView memories={memories} />}
        {sub === "history" && <HistoryView agentId={agentId} />}
      </div>
    </div>
  );
};

// --- Skills ---------------------------------------------------------------

const SkillsView: FC<{ skills: Skill[] }> = ({ skills }) => {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});

  const toggle = (skill: Skill): void => {
    if (expandedId === skill.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(skill.id);
    if (bodies[skill.id] !== undefined) return;
    void (async () => {
      try {
        const { body } = await window.prospero.learning.readSkillBody(skill.id);
        setBodies((b) => ({ ...b, [skill.id]: body }));
      } catch {
        setBodies((b) => ({ ...b, [skill.id]: t("agent.learning.skills.bodyError") }));
      }
    })();
  };

  if (skills.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">
        {t("agent.learning.skills.empty")}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-surface-border">
      {skills.map((skill) => (
        <li key={skill.id}>
          <button
            type="button"
            onClick={() => toggle(skill)}
            className="w-full text-left px-6 py-3 hover:bg-surface-soft"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">{skill.name}</span>
              {skill.agentId === null && (
                <span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
                  🏢 {t("agent.learning.skills.shared")}
                </span>
              )}
              <span className="flex-1" />
              <span
                className="text-[10px] text-ink-soft"
                title={t("agent.learning.skills.usesTitle")}
              >
                ↺ {skill.useCount}
              </span>
              <span
                className="text-[10px] text-ink-soft"
                title={t("agent.learning.skills.trustTitle")}
              >
                {Math.round(skill.trust * 100)}%
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">{skill.description}</p>
          </button>
          {expandedId === skill.id && (
            <pre className="px-6 pb-3 text-xs text-ink-muted whitespace-pre-wrap font-mono">
              {bodies[skill.id] ?? "…"}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
};

// --- Memory ---------------------------------------------------------------

const MemoryView: FC<{ memories: Memory[] }> = ({ memories }) => {
  const { t } = useTranslation();

  if (memories.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">
        {t("agent.learning.memory.empty")}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-surface-border">
      {memories.map((m) => (
        <li key={m.id} className="px-6 py-3">
          <span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
            {t(`agent.learning.memory.kind.${m.kind}`)}
          </span>
          <p className="text-sm text-ink mt-1">{m.body}</p>
        </li>
      ))}
    </ul>
  );
};

// --- History --------------------------------------------------------------

const HistoryView: FC<{ agentId: string }> = ({ agentId }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const runSearch = (): void => {
    const q = query.trim();
    if (q === "") return;
    setSearching(true);
    void (async () => {
      try {
        const hits = await window.prospero.learning.searchSessions(agentId, q);
        setResults(hits);
      } finally {
        setSearching(false);
      }
    })();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 px-6 py-3 border-b border-surface-border">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          placeholder={t("agent.learning.history.placeholder")}
          className="flex-1 text-sm px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
        />
        <button
          type="button"
          onClick={runSearch}
          className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded"
        >
          {t("agent.learning.history.search")}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {searching && (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            {t("agent.learning.history.searching")}
          </div>
        )}
        {!searching && results === null && (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            {t("agent.learning.history.prompt")}
          </div>
        )}
        {!searching && results !== null && results.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            {t("agent.learning.history.empty")}
          </div>
        )}
        {!searching && results !== null && results.length > 0 && (
          <ul className="divide-y divide-surface-border">
            {results.map((hit) => (
              <li key={hit.messageId} className="px-6 py-3">
                <div className="flex items-center gap-2 text-[10px] text-ink-soft">
                  <span className="font-semibold">{hit.senderKind}</span>
                  <span>{new Date(hit.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-ink mt-0.5">{hit.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/components/agent-panel/LearningPanel.tsx
git commit -m "feat(m11): add LearningPanel component"
```

---

## Task 6: Wire the Learning tab into `Agent.tsx` + `AgentHeader` badge

`Agent.tsx` gains the third tab, fetches the agent's skills + memories, passes counts to `AgentHeader` and lists to `LearningPanel`. `AgentHeader` gains the `🎓 N · K` badge that opens the tab.

**Files:**
- Modify: `apps/renderer/src/components/agent-panel/AgentHeader.tsx`
- Modify: `apps/renderer/src/routes/Agent.tsx`

- [ ] **Step 1: Add the badge to `AgentHeader`**

In `apps/renderer/src/components/agent-panel/AgentHeader.tsx`, change the `Props` interface to add three fields:

```typescript
interface Props {
  agent: Agent;
  onAssignTask: () => void;
  onOpenRuns: () => void;
  skillCount: number;
  memoryCount: number;
  onOpenLearning: () => void;
}
```

Change the component signature to destructure them:

```typescript
export const AgentHeader: FC<Props> = ({
  agent,
  onAssignTask,
  onOpenRuns,
  skillCount,
  memoryCount,
  onOpenLearning,
}) => {
```

Add the badge button immediately after the role `<span>` (after the line `</span>` that closes `{agent.role}` — i.e. after the current line 50):

```tsx
      <button
        type="button"
        onClick={onOpenLearning}
        title={t("agent.learning.badgeTitle")}
        className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted hover:bg-surface-border"
      >
        🎓 {skillCount} · {memoryCount}
      </button>
```

- [ ] **Step 2: Add the imports + state to `Agent.tsx`**

In `apps/renderer/src/routes/Agent.tsx`, change the `@prospero/shared` type import to add `Skill` and `Memory`:

```typescript
import type { Message, PermissionRequest, PermissionResolution, Skill, Memory } from "@prospero/shared";
```

Add the `LearningPanel` import after the `DelegationsPanel` import:

```typescript
import { LearningPanel } from "../components/agent-panel/LearningPanel.js";
```

Change the `Tab` type:

```typescript
type Tab = "chat" | "delegations" | "learning";
```

Add two state hooks after `const [messages, setMessages] = useState<Message[]>([]);`:

```typescript
  const [skills, setSkills] = useState<Skill[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
```

- [ ] **Step 3: Fetch skills + memories**

In `apps/renderer/src/routes/Agent.tsx`, add this `useEffect` after the existing "Load all messages for this agent" effect (the one that ends `}, [agent]);` near line 35):

```typescript
  // Load the agent's M11 skills + memory entries. Re-fetched whenever the
  // Learning tab is (re-)opened so it reflects what the agent has captured.
  useEffect(() => {
    if (agent === undefined) return;
    if (tab !== "learning" && skills.length === 0 && memories.length === 0) {
      // initial load still runs once even before the tab is opened — the
      // header badge needs the counts.
    }
    void (async () => {
      const [s, m] = await Promise.all([
        window.prospero.learning.listSkills(agent.id),
        window.prospero.learning.listMemories(agent.id),
      ]);
      setSkills(s);
      setMemories(m);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, tab]);
```

> The effect runs on agent change (badge counts) and on every tab change. Re-running on a chat↔delegations switch is a cheap pair of reads; keeping the dependency list simple is worth it.

- [ ] **Step 4: Pass the new props to `AgentHeader`**

In `apps/renderer/src/routes/Agent.tsx`, change the `<AgentHeader ... />` element to pass the three new props:

```tsx
        <AgentHeader
          agent={agent}
          onAssignTask={() => setShowAssignTask(true)}
          onOpenRuns={() => setShowRuns(true)}
          skillCount={skills.length}
          memoryCount={memories.length}
          onOpenLearning={() => setTab("learning")}
        />
```

- [ ] **Step 5: Add the Learning tab button**

In `apps/renderer/src/routes/Agent.tsx`, add this third tab button inside the tab bar `<div className="flex border-b border-surface-border px-6">`, immediately after the `delegations` `</button>`:

```tsx
          <button
            type="button"
            onClick={() => setTab("learning")}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
              tab === "learning"
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("agent.tabs.learning")}
          </button>
```

- [ ] **Step 6: Render the Learning panel**

In `apps/renderer/src/routes/Agent.tsx`, replace the tab-content ternary:

```tsx
        {tab === "chat" ? (
          <MessageList messages={chatMessages} agents={agents} />
        ) : (
          <DelegationsPanel
            messages={delegationMessages}
            currentAgentId={agent.id}
            agents={agents}
          />
        )}
```

with explicit per-tab rendering:

```tsx
        {tab === "chat" && <MessageList messages={chatMessages} agents={agents} />}
        {tab === "delegations" && (
          <DelegationsPanel
            messages={delegationMessages}
            currentAgentId={agent.id}
            agents={agents}
          />
        )}
        {tab === "learning" && (
          <LearningPanel agentId={agent.id} skills={skills} memories={memories} />
        )}
```

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 8: Full test run**

Run: `pnpm test`
Expected: PASS — all prior tests plus the new channel test, learning-handler tests, and the M11 parity check; no regressions.

- [ ] **Step 9: Commit**

```bash
git add apps/renderer/src/routes/Agent.tsx apps/renderer/src/components/agent-panel/AgentHeader.tsx
git commit -m "feat(m11): wire the learning tab and header badge into the agent page"
```

---

## Self-Review notes

- **Spec coverage (§10, §11 PR-C):** Learning tab with Skills / Memory / History sub-tabs → Task 5 (`LearningPanel`); the tab itself + integration → Task 6; header badge "🎓 N skills · K memories" linking to the tab → Task 6 (`AgentHeader`); the IPC the renderer needs → Tasks 1-3. Deliberately **out of scope** and deferred (documented in "Decisions"): the **Candidates** sub-tab + Accept/Edit/Reject → PR-D; "Promote to company" button → PR-E; trust thumbs + memory edit toggle → PR-F; the `/dashboard` "Org Learnings" card → PR-E; Settings `user.md` editor + derivation slider → PR-F; new inbox kinds / activity events → PR-D/PR-E.
- **Memory sub-tab correction:** spec §10 calls it a `memory.md` markdown view; PR-C backend stores agent memory as `memories` rows (only `user.md` is a file). The Memory sub-tab lists `memories` rows by `kind` — this is the factually correct surface and matches `buildMemoryBlock`.
- **Placeholder scan:** every code step contains complete code; every command has an expected result. No TBD / "handle errors appropriately" — the skill-body fetch failure path is concretely handled (`bodyError` i18n key), the blank-query path returns `[]`, the unknown-agent path returns `[]`.
- **Type consistency:** `SessionSearchHit` is defined once (Task 1) and consumed unchanged in the handler (Task 2), preload (Task 3), `env.d.ts` (Task 3), and `LearningPanel` (Task 5). The four channel constants use one name each across `ipc-channels.ts`, the handler, and the preload. `learningHandlers` / `registerLearningHandlers` / `toFtsMatchExpr` are the exact exported names used by the test and `handlers.ts`. The `window.prospero.learning` method names (`listSkills`, `readSkillBody`, `listMemories`, `searchSessions`) match between preload and `env.d.ts`.
- **Non-regression:** PR-C-UI adds no agent system-prompt content (the token-overhead budget is unaffected — that was a PR-C-backend concern). The four handlers are read-only; no migration, no schema change. The `ipc-channels.test.ts` "unique" + "kebab-case" checks pass for the four new values. The i18n parity test passes because both locales get an identical key set.
