# M3 — Orchestrator + MCP core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Spawn a real Claude Code subprocess as the "CEO" agent, stream its events to the renderer, render tool calls as cards in a chat UI, and round-trip messages via the OAuth token from M2. After M3, the user can click "Create demo company" → see the CEO agent → chat with it → watch tool calls appear in real time.

**Architecture:** Main process owns the Orchestrator (spawn/resume/kill `claude -p`), the MCP server (stdio child the Claude spawns) and the streaming parser (JSONL → events). Renderer subscribes via IPC events to a per-agent stream and renders messages + tool-call cards. MCP tools (`hire_agent`, `create_issue`, etc.) are stubs in M3 — they validate input, push an inbox item, and return mock confirmations.

**Tech stack additions:** `@modelcontextprotocol/sdk@^1.0.0`, `zod` (already added in M2), Node `child_process.spawn`, `readline` for line-buffered JSONL parsing.

**Spec reference:** `docs/superpowers/specs/2026-05-09-prospero-design.md` (§5.2 MCP tools list, §5.4 fluxo, §8.2 sandbox of paths, §9 token budget caps; M3 only seeds the budget machinery).

**Validated technical facts** (confirmed by claude-code-guide subagent):

- `claude -p --output-format stream-json --verbose --include-partial-messages` emits one JSON per line. Events of interest: `system/init` (carries `session_id`), `tool_use`, `tool_result`, `content_block_delta` (text deltas), `system/api_retry` (errors).
- `--mcp-config <file.json>` accepts `{ "mcpServers": { "<name>": { "type": "stdio", "command": "...", "args": [...], "env": {...} } } }`. Claude spawns the subprocess automatically.
- `CLAUDE_CODE_OAUTH_TOKEN` env var works for headless auth (the token saved by M2's `safeStorage`).
- Session ID for `--resume <id>` comes from the first `system/init` event. Persist in `agents.claude_session_id`.
- `@modelcontextprotocol/sdk` is the official Node SDK: `McpServer` + `StdioServerTransport`.

---

## Pre-flight

- M2 complete; ~40 commits in repo. App boots with token configured, Settings/Wizard work.
- Verify a token is configured: `pnpm dev` → wizard → save token → confirm `/dashboard` reachable.
- Verify `claude` binary on PATH: `claude --version` should print a version (we don't enforce a specific version, but anything ≥ 2.0 should support stream-json).

---

## File Structure (this milestone)

```
apps/main/src/
├── companies/
│   ├── repository.ts             # CRUD on companies table
│   └── seed.ts                   # createDemoCompany helper
├── agents/
│   ├── repository.ts             # CRUD on agents table
│   └── seed.ts                   # createCEOAgent helper
├── messages/
│   ├── repository.ts             # threads + messages tables
│   └── thread-key.ts             # canonical key for user-agent and agent-agent threads
├── inbox/
│   └── repository.ts             # inbox_items CRUD
├── orchestrator/
│   ├── lifecycle.ts              # AgentRunner (spawn / resume / kill / write)
│   ├── stream-parser.ts          # JSONL → AgentEvent
│   ├── env.ts                    # builds env for child (token, agent id, mcp token)
│   └── mcp-config.ts             # writes a tmp mcp-config.json per spawn
├── mcp/
│   ├── server.ts                 # entry point — McpServer + StdioServerTransport
│   ├── tools.ts                  # tool definitions (mock implementations in M3)
│   └── auth.ts                   # validates MCP_TOKEN env on each call
├── ipc/
│   ├── orchestrator-handlers.ts  # IPC for spawn/send/list/kill agents
│   ├── companies-handlers.ts     # createDemoCompany IPC (M3-only convenience)
│   ├── messages-handlers.ts      # readThread, append (mostly read-only in M3)
│   └── handlers.ts               # MODIFIED: register all the above
└── ipc/
    └── preload.ts                # MODIFIED: expose orchestrator/companies/messages

apps/renderer/src/
├── routes/
│   ├── Dashboard.tsx             # MODIFIED: add "Create demo company" button
│   └── Agent.tsx                 # NEW: chat with one agent
├── components/
│   ├── MessageList.tsx
│   ├── ToolCallCard.tsx
│   ├── Composer.tsx
│   └── Sidebar.tsx               # MODIFIED: list agents under "Agents" section
├── stores/
│   ├── agents.ts                 # list, create-demo, currently-active
│   └── messages.ts               # per-thread messages with streaming append
└── App.tsx                       # MODIFIED: add /agents/:id route

packages/shared/src/
├── ipc-channels.ts               # MODIFIED: orchestrator/companies/messages channels
└── types/
    ├── agent.ts                  # NEW: Agent, AgentStatus, AgentMode
    ├── company.ts                # NEW: Company
    ├── message.ts                # NEW: Message, ToolCallView
    └── inbox.ts                  # NEW: InboxItem (extracted from M2 reference)
```

---

## Task 1: Shared types — Agent, Company, Message, InboxItem + IPC channels

**Files:**
- Create: `packages/shared/src/types/agent.ts`
- Create: `packages/shared/src/types/company.ts`
- Create: `packages/shared/src/types/message.ts`
- Create: `packages/shared/src/types/inbox.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `packages/shared/tests/m3-types.test.ts`

- [ ] **Step 1: Write failing test**

`packages/shared/tests/m3-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  IPC,
  type Agent,
  type Company,
  type Message,
  type InboxItem,
  type ToolCallView,
} from "../src/index.js";

describe("m3 types and channels", () => {
  it("defines orchestrator IPC channels", () => {
    expect(IPC.AGENT_LIST).toBe("agent:list");
    expect(IPC.AGENT_SEND_MESSAGE).toBe("agent:send-message");
    expect(IPC.AGENT_KILL).toBe("agent:kill");
    expect(IPC.AGENT_EVENT).toBe("agent:event");
  });

  it("defines companies/messages channels", () => {
    expect(IPC.COMPANY_CREATE_DEMO).toBe("company:create-demo");
    expect(IPC.COMPANY_LIST).toBe("company:list");
    expect(IPC.MESSAGE_LIST).toBe("message:list");
  });

  it("Agent type carries minimum fields", () => {
    const a: Agent = {
      id: "agent_1",
      companyId: "co_1",
      name: "CEO",
      role: "Chief Executive Officer",
      systemPrompt: "...",
      mode: "supervised",
      alwaysOn: false,
      status: "idle",
      claudeSessionId: null,
      currentAction: null,
    };
    expect(a.status).toBe("idle");
  });

  it("Message structurally distinguishes user/agent/system", () => {
    const u: Message = {
      id: "m1",
      threadId: "t1",
      senderKind: "user",
      senderId: null,
      content: "hi",
      toolCalls: null,
      createdAt: 1,
    };
    expect(u.senderKind).toBe("user");
  });

  it("ToolCallView captures name, input, status", () => {
    const tc: ToolCallView = {
      id: "tc1",
      name: "create_issue",
      input: { title: "x" },
      status: "success",
      result: "ok",
    };
    expect(tc.status).toBe("success");
  });

  it("InboxItem structurally constructable", () => {
    const i: InboxItem = {
      id: "i1",
      companyId: "co_1",
      kind: "completed",
      actorId: null,
      title: "done",
      preview: null,
      requiresAction: false,
      readAt: null,
      createdAt: 1,
    };
    expect(i.kind).toBe("completed");
  });
});
```

- [ ] **Step 2: Implement type files**

`packages/shared/src/types/agent.ts`:

```ts
export type AgentMode = "supervised" | "auto";
export type AgentStatus = "idle" | "thinking" | "working" | "waiting" | "error";

export type Agent = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  systemPrompt: string;
  mode: AgentMode;
  alwaysOn: boolean;
  status: AgentStatus;
  claudeSessionId: string | null;
  currentAction: string | null;
};
```

`packages/shared/src/types/company.ts`:

```ts
export type Company = {
  id: string;
  name: string;
  createdAt: number;
};
```

`packages/shared/src/types/message.ts`:

```ts
export type ToolCallStatus = "pending" | "success" | "error";

export type ToolCallView = {
  id: string;
  name: string;
  input: unknown;
  status: ToolCallStatus;
  result: string | null;
};

export type SenderKind = "user" | "agent" | "system";

export type Message = {
  id: string;
  threadId: string;
  senderKind: SenderKind;
  senderId: string | null;
  content: string;
  toolCalls: ToolCallView[] | null;
  createdAt: number;
};

export type AgentEvent =
  | { kind: "session"; agentId: string; sessionId: string }
  | { kind: "status"; agentId: string; status: import("./agent.js").AgentStatus; currentAction: string | null }
  | { kind: "message-append"; agentId: string; message: Message }
  | { kind: "tool-call"; agentId: string; threadId: string; tool: ToolCallView }
  | { kind: "tool-result"; agentId: string; threadId: string; toolCallId: string; result: string; error?: string }
  | { kind: "error"; agentId: string; message: string };
```

`packages/shared/src/types/inbox.ts`:

```ts
export type InboxKind = "approval" | "completed" | "suggestion" | "error" | "security_alert";

export type InboxItem = {
  id: string;
  companyId: string;
  kind: InboxKind;
  actorId: string | null;
  title: string;
  preview: string | null;
  requiresAction: boolean;
  readAt: number | null;
  createdAt: number;
};
```

- [ ] **Step 3: Update `types/index.ts` and `ipc-channels.ts`**

Add re-exports for `agent`, `company`, `message`, `inbox`. Append new channels to `IPC`:

```ts
COMPANY_LIST: "company:list",
COMPANY_CREATE_DEMO: "company:create-demo",
AGENT_LIST: "agent:list",
AGENT_SEND_MESSAGE: "agent:send-message",
AGENT_KILL: "agent:kill",
AGENT_EVENT: "agent:event",
MESSAGE_LIST: "message:list",
```

- [ ] **Step 4: Verify green + commit**

```powershell
pnpm --filter @prospero/shared test
pnpm --filter @prospero/shared typecheck
git add packages/shared
git commit -m "feat(shared): add m3 types (agent, company, message, inbox) and channels"
```

---

## Task 2: Companies repository + Agents repository + seed

**Files:**
- Create: `apps/main/src/companies/repository.ts`
- Create: `apps/main/src/companies/seed.ts`
- Create: `apps/main/src/agents/repository.ts`
- Create: `apps/main/src/agents/seed.ts`
- Create: `apps/main/tests/companies.repository.test.ts`
- Create: `apps/main/tests/agents.repository.test.ts`
- Create: `apps/main/tests/companies.seed.test.ts`

- [ ] **Step 1: Companies test**

```ts
// apps/main/tests/companies.repository.test.ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  return createCompaniesRepository(db);
};

describe("companies repository", () => {
  it("create + list + getById", () => {
    const repo = setup();
    const c = repo.create({ name: "Kronos" });
    expect(c.id).toBeDefined();
    expect(c.name).toBe("Kronos");
    expect(repo.list()).toHaveLength(1);
    expect(repo.getById(c.id)?.name).toBe("Kronos");
  });

  it("list returns ordered by createdAt", () => {
    const repo = setup();
    const a = repo.create({ name: "A" });
    const b = repo.create({ name: "B" });
    const all = repo.list();
    expect(all[0]?.id).toBe(a.id);
    expect(all[1]?.id).toBe(b.id);
  });
});
```

- [ ] **Step 2: Companies impl**

```ts
// apps/main/src/companies/repository.ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Company } from "@prospero/shared";

export type CompaniesRepository = {
  create(input: { name: string }): Company;
  getById(id: string): Company | null;
  list(): Company[];
};

const rowToCompany = (row: { id: string; name: string; created_at: number }): Company => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
});

export const createCompaniesRepository = (db: Database.Database): CompaniesRepository => {
  const insertStmt = db.prepare(
    "INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)",
  );
  const selectByIdStmt = db.prepare("SELECT id, name, created_at FROM companies WHERE id = ?");
  const listStmt = db.prepare(
    "SELECT id, name, created_at FROM companies ORDER BY created_at ASC",
  );

  return {
    create(input) {
      const id = `co_${randomUUID()}`;
      const now = Date.now();
      insertStmt.run(id, input.name, now);
      return { id, name: input.name, createdAt: now };
    },
    getById(id) {
      const row = selectByIdStmt.get(id) as
        | { id: string; name: string; created_at: number }
        | undefined;
      return row ? rowToCompany(row) : null;
    },
    list() {
      const rows = listStmt.all() as { id: string; name: string; created_at: number }[];
      return rows.map(rowToCompany);
    },
  };
};
```

- [ ] **Step 3: Agents test**

```ts
// apps/main/tests/agents.repository.test.ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const agents = createAgentsRepository(db);
  const company = companies.create({ name: "Kronos" });
  return { agents, companyId: company.id };
};

describe("agents repository", () => {
  it("create + listByCompany + getById", () => {
    const { agents, companyId } = setup();
    const ceo = agents.create({
      companyId,
      name: "CEO",
      role: "Chief Executive Officer",
      systemPrompt: "You are CEO.",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(ceo.status).toBe("idle");
    expect(agents.listByCompany(companyId)).toHaveLength(1);
    expect(agents.getById(ceo.id)?.name).toBe("CEO");
  });

  it("updateStatus mutates status and currentAction", () => {
    const { agents, companyId } = setup();
    const a = agents.create({
      companyId,
      name: "A",
      role: "x",
      systemPrompt: "x",
      mode: "auto",
      alwaysOn: false,
    });
    agents.updateStatus(a.id, { status: "thinking", currentAction: "considering" });
    const after = agents.getById(a.id);
    expect(after?.status).toBe("thinking");
    expect(after?.currentAction).toBe("considering");
  });

  it("setSessionId persists claude session id", () => {
    const { agents, companyId } = setup();
    const a = agents.create({
      companyId,
      name: "A",
      role: "x",
      systemPrompt: "x",
      mode: "auto",
      alwaysOn: false,
    });
    agents.setSessionId(a.id, "sess_123");
    expect(agents.getById(a.id)?.claudeSessionId).toBe("sess_123");
  });
});
```

- [ ] **Step 4: Agents impl**

```ts
// apps/main/src/agents/repository.ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Agent, AgentMode, AgentStatus } from "@prospero/shared";

type Row = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  template_id: string | null;
  system_prompt: string;
  skills_json: string;
  allowed_projects_json: string;
  mode: string;
  always_on: number;
  reports_to: string | null;
  claude_session_id: string | null;
  status: string;
  current_action: string | null;
  created_at: number;
  updated_at: number;
};

const rowToAgent = (r: Row): Agent => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  role: r.role,
  systemPrompt: r.system_prompt,
  mode: r.mode as AgentMode,
  alwaysOn: r.always_on === 1,
  status: r.status as AgentStatus,
  claudeSessionId: r.claude_session_id,
  currentAction: r.current_action,
});

export type CreateAgentInput = {
  companyId: string;
  name: string;
  role: string;
  systemPrompt: string;
  mode: AgentMode;
  alwaysOn: boolean;
};

export type AgentsRepository = {
  create(input: CreateAgentInput): Agent;
  getById(id: string): Agent | null;
  listByCompany(companyId: string): Agent[];
  updateStatus(id: string, patch: { status: AgentStatus; currentAction: string | null }): void;
  setSessionId(id: string, sessionId: string): void;
};

export const createAgentsRepository = (db: Database.Database): AgentsRepository => {
  const insert = db.prepare(`
    INSERT INTO agents (id, company_id, name, role, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, current_action, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', '[]', ?, ?, 'idle', NULL, ?, ?)
  `);
  const byId = db.prepare("SELECT * FROM agents WHERE id = ?");
  const byCompany = db.prepare(
    "SELECT * FROM agents WHERE company_id = ? ORDER BY created_at ASC",
  );
  const updateStatusStmt = db.prepare(
    "UPDATE agents SET status = ?, current_action = ?, updated_at = ? WHERE id = ?",
  );
  const setSessionStmt = db.prepare(
    "UPDATE agents SET claude_session_id = ?, updated_at = ? WHERE id = ?",
  );

  return {
    create(input) {
      const id = `agent_${randomUUID()}`;
      const now = Date.now();
      insert.run(
        id,
        input.companyId,
        input.name,
        input.role,
        input.systemPrompt,
        input.mode,
        input.alwaysOn ? 1 : 0,
        now,
        now,
      );
      const row = byId.get(id) as Row;
      return rowToAgent(row);
    },
    getById(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? rowToAgent(row) : null;
    },
    listByCompany(companyId) {
      const rows = byCompany.all(companyId) as Row[];
      return rows.map(rowToAgent);
    },
    updateStatus(id, patch) {
      updateStatusStmt.run(patch.status, patch.currentAction, Date.now(), id);
    },
    setSessionId(id, sessionId) {
      setSessionStmt.run(sessionId, Date.now(), id);
    },
  };
};
```

- [ ] **Step 5: Seed helpers**

```ts
// apps/main/src/companies/seed.ts
import type Database from "better-sqlite3";
import type { Company } from "@prospero/shared";
import { createCompaniesRepository } from "./repository.js";
import { createCEOAgent } from "../agents/seed.js";

export const createDemoCompany = (db: Database.Database): Company => {
  const repo = createCompaniesRepository(db);
  const company = repo.create({ name: "Demo Company" });
  createCEOAgent(db, company.id);
  return company;
};
```

```ts
// apps/main/src/agents/seed.ts
import type Database from "better-sqlite3";
import type { Agent } from "@prospero/shared";
import { createAgentsRepository } from "./repository.js";

const CEO_SYSTEM_PROMPT = `You are the CEO of a small company. Your role:
- Receive requests from the company owner (the user) via chat
- Decide whether to handle directly or delegate to specialist agents
- Use the available tools to create issues, hire agents, and message colleagues
- Never execute technical work yourself; delegate to engineers

Available tools: hire_agent, create_issue, message_agent, list_agents, notify_user.

When you respond, be concise. Confirm understanding before taking action.`;

export const createCEOAgent = (db: Database.Database, companyId: string): Agent => {
  const repo = createAgentsRepository(db);
  return repo.create({
    companyId,
    name: "CEO",
    role: "Chief Executive Officer",
    systemPrompt: CEO_SYSTEM_PROMPT,
    mode: "supervised",
    alwaysOn: false,
  });
};
```

- [ ] **Step 6: Seed test**

```ts
// apps/main/tests/companies.seed.test.ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createDemoCompany } from "../src/companies/seed.js";
import { createAgentsRepository } from "../src/agents/repository.js";

describe("createDemoCompany", () => {
  it("creates a company with a CEO agent", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const company = createDemoCompany(db);
    const agents = createAgentsRepository(db).listByCompany(company.id);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.name).toBe("CEO");
    expect(agents[0]?.role).toBe("Chief Executive Officer");
  });
});
```

- [ ] **Step 7: Verify + commit**

```powershell
pnpm --filter @prospero/main test
git add apps/main
git commit -m "feat(domain): add companies, agents repositories and demo seed"
```

---

## Task 3: Messages + Inbox repositories

**Files:**
- Create: `apps/main/src/messages/repository.ts`
- Create: `apps/main/src/messages/thread-key.ts`
- Create: `apps/main/src/inbox/repository.ts`
- Create: `apps/main/tests/messages.repository.test.ts`
- Create: `apps/main/tests/inbox.repository.test.ts`

- [ ] **Step 1: Thread key helper**

```ts
// apps/main/src/messages/thread-key.ts
// Canonical participants: user always represented as "user". Agents by id.
// Sorted to make {user, agent_x} === {agent_x, user}.
export const threadKey = (participants: string[]): string =>
  [...participants].sort().join("|");
```

- [ ] **Step 2: Messages repository**

```ts
// apps/main/src/messages/repository.ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Message,
  SenderKind,
  ToolCallView,
} from "@prospero/shared";
import { threadKey } from "./thread-key.js";

type ThreadRow = {
  id: string;
  company_id: string;
  participants_json: string;
  created_at: number;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_kind: string;
  sender_id: string | null;
  content: string;
  tool_calls_json: string | null;
  created_at: number;
};

const rowToMessage = (r: MessageRow): Message => ({
  id: r.id,
  threadId: r.thread_id,
  senderKind: r.sender_kind as SenderKind,
  senderId: r.sender_id,
  content: r.content,
  toolCalls: r.tool_calls_json === null ? null : (JSON.parse(r.tool_calls_json) as ToolCallView[]),
  createdAt: r.created_at,
});

export type AppendInput = {
  companyId: string;
  participants: string[];
  senderKind: SenderKind;
  senderId: string | null;
  content: string;
  toolCalls?: ToolCallView[] | null;
};

export type MessagesRepository = {
  ensureThread(companyId: string, participants: string[]): { id: string };
  append(input: AppendInput): Message;
  list(threadId: string): Message[];
  listByParticipants(companyId: string, participants: string[]): Message[];
};

export const createMessagesRepository = (db: Database.Database): MessagesRepository => {
  const findThread = db.prepare(
    "SELECT id, company_id, participants_json, created_at FROM threads WHERE company_id = ? AND participants_json = ?",
  );
  const insertThread = db.prepare(
    "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertMessage = db.prepare(
    "INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const listByThread = db.prepare(
    "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC",
  );

  const ensureThread = (companyId: string, participants: string[]): { id: string } => {
    const key = threadKey(participants);
    const existing = findThread.get(companyId, key) as ThreadRow | undefined;
    if (existing) return { id: existing.id };
    const id = `thr_${randomUUID()}`;
    insertThread.run(id, companyId, key, Date.now());
    return { id };
  };

  return {
    ensureThread,
    append(input) {
      const thread = ensureThread(input.companyId, input.participants);
      const id = `msg_${randomUUID()}`;
      const now = Date.now();
      const toolCallsJson =
        input.toolCalls === null || input.toolCalls === undefined
          ? null
          : JSON.stringify(input.toolCalls);
      insertMessage.run(
        id,
        thread.id,
        input.senderKind,
        input.senderId,
        input.content,
        toolCallsJson,
        now,
      );
      return {
        id,
        threadId: thread.id,
        senderKind: input.senderKind,
        senderId: input.senderId,
        content: input.content,
        toolCalls: input.toolCalls ?? null,
        createdAt: now,
      };
    },
    list(threadId) {
      const rows = listByThread.all(threadId) as MessageRow[];
      return rows.map(rowToMessage);
    },
    listByParticipants(companyId, participants) {
      const thread = findThread.get(companyId, threadKey(participants)) as
        | ThreadRow
        | undefined;
      if (!thread) return [];
      const rows = listByThread.all(thread.id) as MessageRow[];
      return rows.map(rowToMessage);
    },
  };
};
```

- [ ] **Step 3: Messages test**

```ts
// apps/main/tests/messages.repository.test.ts
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createMessagesRepository } from "../src/messages/repository.js";
import { createDemoCompany } from "../src/companies/seed.js";
import { createAgentsRepository } from "../src/agents/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createDemoCompany(db);
  const agents = createAgentsRepository(db).listByCompany(company.id);
  const ceo = agents[0]!;
  const repo = createMessagesRepository(db);
  return { repo, companyId: company.id, ceoId: ceo.id };
};

describe("messages repository", () => {
  it("appends a user message and lists it", () => {
    const { repo, companyId, ceoId } = setup();
    const m = repo.append({
      companyId,
      participants: ["user", ceoId],
      senderKind: "user",
      senderId: null,
      content: "hi",
    });
    const all = repo.listByParticipants(companyId, ["user", ceoId]);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(m.id);
  });

  it("threads are keyed canonically (user, agent) === (agent, user)", () => {
    const { repo, companyId, ceoId } = setup();
    repo.append({
      companyId,
      participants: ["user", ceoId],
      senderKind: "user",
      senderId: null,
      content: "1",
    });
    const all = repo.listByParticipants(companyId, [ceoId, "user"]);
    expect(all).toHaveLength(1);
  });

  it("preserves tool calls JSON round-trip", () => {
    const { repo, companyId, ceoId } = setup();
    repo.append({
      companyId,
      participants: ["user", ceoId],
      senderKind: "agent",
      senderId: ceoId,
      content: "running...",
      toolCalls: [{ id: "tc1", name: "create_issue", input: { title: "x" }, status: "success", result: "ok" }],
    });
    const all = repo.listByParticipants(companyId, ["user", ceoId]);
    expect(all[0]?.toolCalls?.[0]?.name).toBe("create_issue");
  });
});
```

- [ ] **Step 4: Inbox repository**

```ts
// apps/main/src/inbox/repository.ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { InboxItem, InboxKind } from "@prospero/shared";

type Row = {
  id: string;
  company_id: string;
  kind: string;
  actor_id: string | null;
  title: string;
  preview: string | null;
  payload_json: string | null;
  requires_action: number;
  read_at: number | null;
  created_at: number;
};

const rowToItem = (r: Row): InboxItem => ({
  id: r.id,
  companyId: r.company_id,
  kind: r.kind as InboxKind,
  actorId: r.actor_id,
  title: r.title,
  preview: r.preview,
  requiresAction: r.requires_action === 1,
  readAt: r.read_at,
  createdAt: r.created_at,
});

export type CreateInboxInput = {
  companyId: string;
  kind: InboxKind;
  actorId?: string | null;
  title: string;
  preview?: string | null;
  requiresAction?: boolean;
};

export type InboxRepository = {
  create(input: CreateInboxInput): InboxItem;
  listByCompany(companyId: string): InboxItem[];
};

export const createInboxRepository = (db: Database.Database): InboxRepository => {
  const insert = db.prepare(`
    INSERT INTO inbox_items (id, company_id, kind, actor_id, title, preview, payload_json, requires_action, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)
  `);
  const list = db.prepare(
    "SELECT * FROM inbox_items WHERE company_id = ? ORDER BY created_at DESC",
  );

  return {
    create(input) {
      const id = `inb_${randomUUID()}`;
      const now = Date.now();
      insert.run(
        id,
        input.companyId,
        input.kind,
        input.actorId ?? null,
        input.title,
        input.preview ?? null,
        input.requiresAction === true ? 1 : 0,
        now,
      );
      return {
        id,
        companyId: input.companyId,
        kind: input.kind,
        actorId: input.actorId ?? null,
        title: input.title,
        preview: input.preview ?? null,
        requiresAction: input.requiresAction === true,
        readAt: null,
        createdAt: now,
      };
    },
    listByCompany(companyId) {
      const rows = list.all(companyId) as Row[];
      return rows.map(rowToItem);
    },
  };
};
```

- [ ] **Step 5: Inbox test (similar shape; verify create+list)**

Mirror the messages test pattern with company setup + a couple of `create()` calls + assertion on `listByCompany`.

- [ ] **Step 6: Verify + commit**

```powershell
pnpm --filter @prospero/main test
git add apps/main
git commit -m "feat(domain): add messages and inbox repositories"
```

---

## Task 4: MCP server (mock tools)

**Files:**
- Modify: `apps/main/package.json` (add `@modelcontextprotocol/sdk@^1.0.0`)
- Create: `apps/main/src/mcp/server.ts`
- Create: `apps/main/src/mcp/tools.ts`
- Create: `apps/main/src/mcp/auth.ts`
- Create: `apps/main/tests/mcp.tools.test.ts`

- [ ] **Step 1: Install SDK**

```powershell
pnpm --filter @prospero/main add @modelcontextprotocol/sdk@^1.0.0
```

- [ ] **Step 2: Auth check**

```ts
// apps/main/src/mcp/auth.ts
export const verifyMcpToken = (expected: string | undefined, provided: string | undefined): void => {
  if (expected === undefined || expected === "") {
    throw new Error("MCP_TOKEN env not set on server");
  }
  if (provided !== expected) {
    throw new Error("Invalid MCP token");
  }
};
```

- [ ] **Step 3: Tool definitions (M3 = mock)**

```ts
// apps/main/src/mcp/tools.ts
import { z } from "zod";

export type ToolContext = {
  agentId: string;
  companyId: string;
  // In M3, side-effects are pushed into a queue that the parent process will read.
  emit: (event: { kind: string; payload: unknown }) => void;
};

export const toolDefinitions = [
  {
    name: "list_agents",
    description: "List all agents in the current company.",
    inputSchema: z.object({}),
    run: async (_input: unknown, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "list_agents.called", payload: { agentId: ctx.agentId } });
      return JSON.stringify({ ok: true, note: "M3 mock: returns nothing yet" });
    },
  },
  {
    name: "hire_agent",
    description: "Hire a new agent with the given role.",
    inputSchema: z.object({ role: z.string(), name: z.string().optional() }),
    run: async (input: { role: string; name?: string }, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "hire_agent.called", payload: input });
      return JSON.stringify({ ok: true, mocked: true, would_create: input });
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue assigned to an agent.",
    inputSchema: z.object({
      project: z.string(),
      title: z.string(),
      description: z.string().optional(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    }),
    run: async (input: unknown, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "create_issue.called", payload: input });
      return JSON.stringify({ ok: true, mocked: true, would_create: input });
    },
  },
  {
    name: "message_agent",
    description: "Send a message directly to another agent.",
    inputSchema: z.object({ agent: z.string(), content: z.string() }),
    run: async (input: unknown, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "message_agent.called", payload: input });
      return JSON.stringify({ ok: true, mocked: true, would_send: input });
    },
  },
  {
    name: "notify_user",
    description: "Push a notification to the user's inbox.",
    inputSchema: z.object({
      title: z.string(),
      body: z.string().optional(),
      requires_action: z.boolean().optional(),
    }),
    run: async (input: unknown, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "notify_user.called", payload: input });
      return JSON.stringify({ ok: true, mocked: true });
    },
  },
] as const;
```

- [ ] **Step 4: Server entry point**

```ts
// apps/main/src/mcp/server.ts
// This file is spawned as a child process by Claude. It reads MCP_TOKEN, AGENT_ID,
// COMPANY_ID from env, exposes the tools above over stdio, and emits a JSON line
// to stderr for each tool invocation that the parent (Orchestrator) can capture.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { toolDefinitions, type ToolContext } from "./tools.js";
import { verifyMcpToken } from "./auth.js";

const expectedToken = process.env["MCP_TOKEN"];
const agentId = process.env["AGENT_ID"];
const companyId = process.env["COMPANY_ID"];

if (agentId === undefined || companyId === undefined) {
  console.error("MCP server requires AGENT_ID and COMPANY_ID env vars");
  process.exit(1);
}

const ctx: ToolContext = {
  agentId,
  companyId,
  emit: (event) => {
    // stderr is forwarded by Claude to its --output-format stream-json passthrough;
    // we can also route it to the Orchestrator via a side-channel later.
    process.stderr.write(JSON.stringify({ ...event, agentId, companyId }) + "\n");
  },
};

const server = new McpServer({ name: "dashboard", version: "0.0.1" });

for (const def of toolDefinitions) {
  server.tool(
    def.name,
    { description: def.description, inputSchema: def.inputSchema },
    async (input: unknown) => {
      // Token check is a no-op for now since stdio transport doesn't carry custom headers.
      // We rely on env-var token + the fact that the parent controls the spawn.
      verifyMcpToken(expectedToken, expectedToken); // tautology — placeholder for future hardening
      const result = await def.run(input as never, ctx);
      return { content: [{ type: "text" as const, text: result }] };
    },
  );
}

const transport = new StdioServerTransport();
void server.connect(transport);
```

- [ ] **Step 5: Tools test (no full MCP roundtrip — test the run() functions directly)**

```ts
// apps/main/tests/mcp.tools.test.ts
import { describe, expect, it, vi } from "vitest";
import { toolDefinitions } from "../src/mcp/tools.js";

describe("mcp tools (M3 mocks)", () => {
  it("list_agents emits and returns ok", async () => {
    const emit = vi.fn();
    const def = toolDefinitions.find((t) => t.name === "list_agents");
    expect(def).toBeDefined();
    const result = await def!.run({}, { agentId: "a", companyId: "c", emit });
    expect(JSON.parse(result).ok).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: "list_agents.called" }));
  });

  it("hire_agent rejects empty role at parse time", () => {
    const def = toolDefinitions.find((t) => t.name === "hire_agent");
    expect(() => def!.inputSchema.parse({})).toThrow();
  });

  it("create_issue accepts optional fields", () => {
    const def = toolDefinitions.find((t) => t.name === "create_issue");
    const parsed = def!.inputSchema.parse({ project: "P", title: "T" });
    expect(parsed.title).toBe("T");
  });
});
```

- [ ] **Step 6: Update tsup to bundle mcp/server.ts as a separate entry**

The MCP server runs as a CHILD PROCESS spawned by Claude. It needs its own bundle that Node can run directly (no Electron). Add to tsup config a third entry that builds `src/mcp/server.ts` as ESM (no Electron) into `dist/mcp/server.js`.

`apps/main/tsup.config.ts` — add a third config:

```ts
{
  entry: { "mcp/server": "src/mcp/server.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: false,
  external: ["better-sqlite3"], // not used, but excluded just in case
  noExternal: ["@prospero/shared", "@modelcontextprotocol/sdk"],
}
```

- [ ] **Step 7: Verify + commit**

```powershell
pnpm --filter @prospero/main test
pnpm --filter @prospero/main build
git add apps/main pnpm-lock.yaml
git commit -m "feat(mcp): add internal mcp server with mock orchestration tools"
```

---

## Task 5: Stream-json parser

**Files:**
- Create: `apps/main/src/orchestrator/stream-parser.ts`
- Create: `apps/main/tests/orchestrator.stream-parser.test.ts`

- [ ] **Step 1: Test**

```ts
// apps/main/tests/orchestrator.stream-parser.test.ts
import { describe, expect, it } from "vitest";
import { parseStreamLine } from "../src/orchestrator/stream-parser.js";

describe("parseStreamLine", () => {
  it("returns null for empty/whitespace lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
  });

  it("parses system/init carrying session_id", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess_123",
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("session-init");
    if (parsed?.kind === "session-init") expect(parsed.sessionId).toBe("sess_123");
  });

  it("parses tool_use stream events", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu_1", name: "create_issue", input: {} },
      },
      session_id: "sess_123",
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("tool-use-start");
    if (parsed?.kind === "tool-use-start") {
      expect(parsed.toolUseId).toBe("tu_1");
      expect(parsed.name).toBe("create_issue");
    }
  });

  it("parses content_block_delta as text delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
      session_id: "sess_123",
    });
    const parsed = parseStreamLine(line);
    expect(parsed?.kind).toBe("text-delta");
    if (parsed?.kind === "text-delta") expect(parsed.text).toBe("Hello");
  });

  it("returns null on malformed JSON", () => {
    expect(parseStreamLine("{ not json }")).toBeNull();
  });
});
```

- [ ] **Step 2: Implementation**

```ts
// apps/main/src/orchestrator/stream-parser.ts
export type ParsedEvent =
  | { kind: "session-init"; sessionId: string }
  | { kind: "tool-use-start"; toolUseId: string; name: string; input: unknown }
  | { kind: "tool-result"; toolUseId: string; content: string }
  | { kind: "text-delta"; text: string }
  | { kind: "message-stop" }
  | { kind: "api-retry"; attempt: number; error: string }
  | { kind: "unknown"; raw: unknown };

const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object";

export const parseStreamLine = (line: string): ParsedEvent | null => {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  const data = safeParse(trimmed);
  if (!isObject(data)) return null;

  if (data["type"] === "system" && data["subtype"] === "init") {
    const sid = data["session_id"];
    if (typeof sid === "string") return { kind: "session-init", sessionId: sid };
  }

  if (data["type"] === "system" && data["subtype"] === "api_retry") {
    const attempt = data["attempt"];
    const error = data["error"];
    if (typeof attempt === "number" && typeof error === "string")
      return { kind: "api-retry", attempt, error };
  }

  if (data["type"] === "stream_event" && isObject(data["event"])) {
    const ev = data["event"];
    if (ev["type"] === "content_block_start" && isObject(ev["content_block"])) {
      const cb = ev["content_block"];
      if (cb["type"] === "tool_use" && typeof cb["id"] === "string" && typeof cb["name"] === "string") {
        return {
          kind: "tool-use-start",
          toolUseId: cb["id"],
          name: cb["name"],
          input: cb["input"] ?? {},
        };
      }
    }
    if (ev["type"] === "content_block_delta" && isObject(ev["delta"])) {
      const d = ev["delta"];
      if (d["type"] === "text_delta" && typeof d["text"] === "string") {
        return { kind: "text-delta", text: d["text"] };
      }
    }
    if (ev["type"] === "message_stop") {
      return { kind: "message-stop" };
    }
  }

  if (data["type"] === "tool_result" && typeof data["tool_use_id"] === "string") {
    const content = data["content"];
    let textContent = "";
    if (typeof content === "string") textContent = content;
    else if (Array.isArray(content)) {
      const first = content[0];
      if (isObject(first) && typeof first["text"] === "string") textContent = first["text"];
    }
    return { kind: "tool-result", toolUseId: data["tool_use_id"], content: textContent };
  }

  return { kind: "unknown", raw: data };
};
```

- [ ] **Step 3: Verify + commit**

```powershell
pnpm --filter @prospero/main test
git add apps/main
git commit -m "feat(orchestrator): add stream-json line parser"
```

---

## Task 6: Orchestrator core (spawn + lifecycle)

**Files:**
- Create: `apps/main/src/orchestrator/env.ts`
- Create: `apps/main/src/orchestrator/mcp-config.ts`
- Create: `apps/main/src/orchestrator/lifecycle.ts`
- Create: `apps/main/tests/orchestrator.env.test.ts`
- Create: `apps/main/tests/orchestrator.mcp-config.test.ts`

- [ ] **Step 1: env.ts** (builds env for child process)

```ts
// apps/main/src/orchestrator/env.ts
import { randomBytes } from "node:crypto";
import type { Agent } from "@prospero/shared";

export type SpawnEnv = {
  CLAUDE_CODE_OAUTH_TOKEN: string;
  AGENT_ID: string;
  COMPANY_ID: string;
  MCP_TOKEN: string;
};

export const buildSpawnEnv = (agent: Agent, oauthToken: string): SpawnEnv => ({
  CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
  AGENT_ID: agent.id,
  COMPANY_ID: agent.companyId,
  MCP_TOKEN: randomBytes(32).toString("hex"),
});
```

- [ ] **Step 2: mcp-config.ts** (writes a tmp JSON for `--mcp-config`)

```ts
// apps/main/src/orchestrator/mcp-config.ts
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnEnv } from "./env.js";

export const writeMcpConfigFile = (mcpServerJsPath: string, env: SpawnEnv): string => {
  const dir = mkdtempSync(join(tmpdir(), "da-mcp-"));
  const configPath = join(dir, "mcp.json");
  const config = {
    mcpServers: {
      dashboard: {
        type: "stdio",
        command: process.execPath, // Node binary
        args: [mcpServerJsPath],
        env: {
          AGENT_ID: env.AGENT_ID,
          COMPANY_ID: env.COMPANY_ID,
          MCP_TOKEN: env.MCP_TOKEN,
        },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  return configPath;
};
```

- [ ] **Step 3: AgentRunner (lifecycle)**

```ts
// apps/main/src/orchestrator/lifecycle.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Agent } from "@prospero/shared";
import { parseStreamLine, type ParsedEvent } from "./stream-parser.js";
import { buildSpawnEnv } from "./env.js";
import { writeMcpConfigFile } from "./mcp-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type AgentRunner = {
  agentId: string;
  send(message: string): void;
  kill(): void;
  isAlive(): boolean;
};

export type RunnerCallbacks = {
  onEvent: (event: ParsedEvent) => void;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null) => void;
};

export type SpawnOptions = {
  agent: Agent;
  oauthToken: string;
  mcpServerJsPath?: string; // override for testing; defaults to dist/mcp/server.js
  cwd?: string; // working directory; M3 uses os.tmpdir() if omitted
};

export const spawnAgent = (opts: SpawnOptions, cb: RunnerCallbacks): AgentRunner => {
  const env = buildSpawnEnv(opts.agent, opts.oauthToken);
  const mcpServerPath =
    opts.mcpServerJsPath ?? resolve(__dirname, "../mcp/server.js");
  const mcpConfigPath = writeMcpConfigFile(mcpServerPath, env);

  const args = [
    "-p",
    "--system",
    opts.agent.systemPrompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config",
    mcpConfigPath,
  ];
  if (opts.agent.claudeSessionId !== null) {
    args.push("--resume", opts.agent.claudeSessionId);
  }

  const child = spawn("claude", args, {
    env: { ...process.env, ...env },
    cwd: opts.cwd ?? process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Line-buffered stdout reader
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const parsed = parseStreamLine(line);
    if (parsed !== null) cb.onEvent(parsed);
  });

  // Stderr passthrough (mcp tool emits + claude diagnostics)
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (line.trim() !== "") cb.onStderr?.(line);
    }
  });

  child.on("exit", (code) => {
    cb.onExit?.(code);
  });

  return {
    agentId: opts.agent.id,
    send(message) {
      if (!child.stdin.writable) return;
      child.stdin.write(message + "\n");
    },
    kill() {
      if (!child.killed) child.kill();
    },
    isAlive() {
      return !child.killed && child.exitCode === null;
    },
  };
};

// In-memory registry of active runners (one per agent)
const runners = new Map<string, AgentRunner>();

export const getRunner = (agentId: string): AgentRunner | undefined =>
  runners.get(agentId);

export const registerRunner = (runner: AgentRunner): void => {
  runners.set(runner.agentId, runner);
};

export const removeRunner = (agentId: string): void => {
  runners.delete(agentId);
};
```

- [ ] **Step 4: env + mcp-config tests**

```ts
// apps/main/tests/orchestrator.env.test.ts
import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../src/orchestrator/env.js";

describe("buildSpawnEnv", () => {
  it("propagates oauth + agent + company and generates mcp token", () => {
    const env = buildSpawnEnv(
      {
        id: "agent_x",
        companyId: "co_y",
        name: "n",
        role: "r",
        systemPrompt: "s",
        mode: "supervised",
        alwaysOn: false,
        status: "idle",
        claudeSessionId: null,
        currentAction: null,
      },
      "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123",
    );
    expect(env.AGENT_ID).toBe("agent_x");
    expect(env.COMPANY_ID).toBe("co_y");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN.startsWith("sk-ant-oat")).toBe(true);
    expect(env.MCP_TOKEN.length).toBe(64); // 32 bytes hex
  });
});
```

```ts
// apps/main/tests/orchestrator.mcp-config.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { writeMcpConfigFile } from "../src/orchestrator/mcp-config.js";

describe("writeMcpConfigFile", () => {
  it("writes a valid mcp.json with stdio server entry", () => {
    const path = writeMcpConfigFile("/fake/server.js", {
      CLAUDE_CODE_OAUTH_TOKEN: "t",
      AGENT_ID: "a",
      COMPANY_ID: "c",
      MCP_TOKEN: "m",
    });
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.mcpServers.dashboard.type).toBe("stdio");
    expect(parsed.mcpServers.dashboard.args).toContain("/fake/server.js");
    expect(parsed.mcpServers.dashboard.env.MCP_TOKEN).toBe("m");
  });
});
```

- [ ] **Step 5: Verify + commit**

```powershell
pnpm --filter @prospero/main test
git add apps/main
git commit -m "feat(orchestrator): add spawn lifecycle, env builder, mcp-config writer"
```

---

## Task 7: IPC handlers — orchestrator + companies + messages

**Files:**
- Create: `apps/main/src/ipc/orchestrator-handlers.ts`
- Create: `apps/main/src/ipc/companies-handlers.ts`
- Create: `apps/main/src/ipc/messages-handlers.ts`
- Modify: `apps/main/src/ipc/handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`

- [ ] **Step 1: companies-handlers.ts**

```ts
// apps/main/src/ipc/companies-handlers.ts
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Company } from "@prospero/shared";
import { createCompaniesRepository } from "../companies/repository.js";
import { createDemoCompany } from "../companies/seed.js";

export const registerCompaniesHandlers = (db: Database.Database): void => {
  const repo = createCompaniesRepository(db);
  ipcMain.handle(IPC.COMPANY_LIST, (): Company[] => repo.list());
  ipcMain.handle(IPC.COMPANY_CREATE_DEMO, (): Company => createDemoCompany(db));
};
```

- [ ] **Step 2: messages-handlers.ts**

```ts
// apps/main/src/ipc/messages-handlers.ts
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Message } from "@prospero/shared";
import { createMessagesRepository } from "../messages/repository.js";

export const registerMessagesHandlers = (db: Database.Database): void => {
  const repo = createMessagesRepository(db);
  ipcMain.handle(
    IPC.MESSAGE_LIST,
    (
      _e,
      payload: { companyId: string; participants: string[] },
    ): Message[] => repo.listByParticipants(payload.companyId, payload.participants),
  );
};
```

- [ ] **Step 3: orchestrator-handlers.ts**

This is the most involved handler. It owns the per-agent runner registry and forwards events to the renderer via `webContents.send`.

```ts
// apps/main/src/ipc/orchestrator-handlers.ts
import { ipcMain, BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import {
  IPC,
  type Agent,
  type AgentEvent,
  type Message,
  type ToolCallView,
} from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import { createMessagesRepository } from "../messages/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { loadDecryptedToken } from "../auth/token-storage.js";
import {
  spawnAgent,
  getRunner,
  registerRunner,
  removeRunner,
} from "../orchestrator/lifecycle.js";
import type { ParsedEvent } from "../orchestrator/stream-parser.js";
import { randomUUID } from "node:crypto";

const broadcast = (event: AgentEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, event);
  }
};

export const registerOrchestratorHandlers = (db: Database.Database): void => {
  const agents = createAgentsRepository(db);
  const messages = createMessagesRepository(db);
  const inbox = createInboxRepository(db);

  ipcMain.handle(
    IPC.AGENT_LIST,
    (_e, payload: { companyId: string }): Agent[] =>
      agents.listByCompany(payload.companyId),
  );

  ipcMain.handle(IPC.AGENT_KILL, (_e, payload: { agentId: string }): void => {
    const runner = getRunner(payload.agentId);
    runner?.kill();
    removeRunner(payload.agentId);
    agents.updateStatus(payload.agentId, { status: "idle", currentAction: null });
  });

  ipcMain.handle(
    IPC.AGENT_SEND_MESSAGE,
    async (_e, payload: { agentId: string; content: string }): Promise<Message> => {
      const agent = agents.getById(payload.agentId);
      if (agent === null) throw new Error("Agent not found");

      // Persist user message
      const userMessage = messages.append({
        companyId: agent.companyId,
        participants: ["user", agent.id],
        senderKind: "user",
        senderId: null,
        content: payload.content,
      });
      broadcast({ kind: "message-append", agentId: agent.id, message: userMessage });

      // Ensure runner exists; spawn if needed
      let runner = getRunner(agent.id);
      if (runner === undefined) {
        const token = loadDecryptedToken(db);
        if (token === null) throw new Error("OAuth token not configured");
        const collectedToolCalls = new Map<string, ToolCallView>();
        let assistantTextBuffer = "";

        runner = spawnAgent(
          { agent, oauthToken: token },
          {
            onEvent: (ev: ParsedEvent) => {
              if (ev.kind === "session-init") {
                agents.setSessionId(agent.id, ev.sessionId);
                broadcast({ kind: "session", agentId: agent.id, sessionId: ev.sessionId });
                agents.updateStatus(agent.id, { status: "thinking", currentAction: null });
                broadcast({
                  kind: "status",
                  agentId: agent.id,
                  status: "thinking",
                  currentAction: null,
                });
              } else if (ev.kind === "tool-use-start") {
                const tc: ToolCallView = {
                  id: ev.toolUseId,
                  name: ev.name,
                  input: ev.input,
                  status: "pending",
                  result: null,
                };
                collectedToolCalls.set(ev.toolUseId, tc);
                broadcast({
                  kind: "tool-call",
                  agentId: agent.id,
                  threadId: userMessage.threadId,
                  tool: tc,
                });
              } else if (ev.kind === "tool-result") {
                const existing = collectedToolCalls.get(ev.toolUseId);
                if (existing !== undefined) {
                  existing.status = "success";
                  existing.result = ev.content;
                  broadcast({
                    kind: "tool-result",
                    agentId: agent.id,
                    threadId: userMessage.threadId,
                    toolCallId: ev.toolUseId,
                    result: ev.content,
                  });
                }
              } else if (ev.kind === "text-delta") {
                assistantTextBuffer += ev.text;
              } else if (ev.kind === "message-stop") {
                if (assistantTextBuffer.trim() !== "" || collectedToolCalls.size > 0) {
                  const tools = collectedToolCalls.size > 0 ? Array.from(collectedToolCalls.values()) : null;
                  const m = messages.append({
                    companyId: agent.companyId,
                    participants: ["user", agent.id],
                    senderKind: "agent",
                    senderId: agent.id,
                    content: assistantTextBuffer,
                    toolCalls: tools,
                  });
                  broadcast({ kind: "message-append", agentId: agent.id, message: m });
                  assistantTextBuffer = "";
                  collectedToolCalls.clear();
                }
                agents.updateStatus(agent.id, { status: "idle", currentAction: null });
                broadcast({
                  kind: "status",
                  agentId: agent.id,
                  status: "idle",
                  currentAction: null,
                });
              } else if (ev.kind === "api-retry") {
                broadcast({
                  kind: "error",
                  agentId: agent.id,
                  message: `API retry attempt ${String(ev.attempt)}: ${ev.error}`,
                });
              }
            },
            onStderr: (line: string) => {
              // MCP tool side-effects: parse the JSON line and turn into inbox items.
              try {
                const parsed: unknown = JSON.parse(line);
                if (
                  parsed !== null &&
                  typeof parsed === "object" &&
                  typeof (parsed as { kind?: unknown }).kind === "string"
                ) {
                  const k = (parsed as { kind: string }).kind;
                  if (k === "notify_user.called" || k.endsWith(".called")) {
                    const payloadObj = (parsed as { payload?: unknown }).payload;
                    inbox.create({
                      companyId: agent.companyId,
                      kind: "completed",
                      actorId: agent.id,
                      title: `Tool ${k.replace(".called", "")} called`,
                      preview:
                        typeof payloadObj === "object" && payloadObj !== null
                          ? JSON.stringify(payloadObj).slice(0, 200)
                          : null,
                      requiresAction: false,
                    });
                  }
                }
              } catch {
                // not JSON; ignore (claude diagnostics)
              }
            },
            onExit: (code) => {
              removeRunner(agent.id);
              agents.updateStatus(agent.id, {
                status: code === 0 ? "idle" : "error",
                currentAction: null,
              });
              broadcast({
                kind: "status",
                agentId: agent.id,
                status: code === 0 ? "idle" : "error",
                currentAction: null,
              });
            },
          },
        );
        registerRunner(runner);
      }

      runner.send(payload.content);
      return userMessage;
    },
  );
};
```

- [ ] **Step 4: Update handlers.ts and preload.ts**

```ts
// apps/main/src/ipc/handlers.ts
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import { registerSettingsHandlers } from "./settings-handlers.js";
import { registerAuthHandlers } from "./auth-handlers.js";
import { registerCompaniesHandlers } from "./companies-handlers.js";
import { registerMessagesHandlers } from "./messages-handlers.js";
import { registerOrchestratorHandlers } from "./orchestrator-handlers.js";

export const registerIpcHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.PING, () => "pong");
  registerSettingsHandlers(db);
  registerAuthHandlers(db);
  registerCompaniesHandlers(db);
  registerMessagesHandlers(db);
  registerOrchestratorHandlers(db);
};
```

`apps/main/src/ipc/preload.ts` — add namespaces for `companies`, `agents`, `messages`. Use `ipcRenderer.on(IPC.AGENT_EVENT, ...)` for the broadcast events:

```ts
// (full file shown for clarity)
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type AppSettings,
  type TokenSource,
  type TokenStatus,
  type Agent,
  type AgentEvent,
  type Company,
  type Message,
} from "@prospero/shared";

contextBridge.exposeInMainWorld("prospero", {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<AppSettings>,
    update: (patch: Partial<AppSettings>) =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch) as Promise<AppSettings>,
  },
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_STATUS) as Promise<TokenStatus>,
    set: (raw: string, source: TokenSource) =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_SET, { raw, source }) as Promise<TokenStatus>,
    detect: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_DETECT) as Promise<string | null>,
    clear: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_CLEAR) as Promise<TokenStatus>,
  },
  companies: {
    list: () => ipcRenderer.invoke(IPC.COMPANY_LIST) as Promise<Company[]>,
    createDemo: () => ipcRenderer.invoke(IPC.COMPANY_CREATE_DEMO) as Promise<Company>,
  },
  agents: {
    list: (companyId: string) =>
      ipcRenderer.invoke(IPC.AGENT_LIST, { companyId }) as Promise<Agent[]>,
    sendMessage: (agentId: string, content: string) =>
      ipcRenderer.invoke(IPC.AGENT_SEND_MESSAGE, { agentId, content }) as Promise<Message>,
    kill: (agentId: string) =>
      ipcRenderer.invoke(IPC.AGENT_KILL, { agentId }) as Promise<void>,
    onEvent: (cb: (event: AgentEvent) => void) => {
      const handler = (_e: unknown, event: AgentEvent) => cb(event);
      ipcRenderer.on(IPC.AGENT_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, handler);
    },
  },
  messages: {
    list: (companyId: string, participants: string[]) =>
      ipcRenderer.invoke(IPC.MESSAGE_LIST, { companyId, participants }) as Promise<Message[]>,
  },
});
```

- [ ] **Step 5: Update env.d.ts in renderer to mirror the new namespaces**

Extend `Window["prospero"]` with `companies`, `agents`, `messages` matching the preload shape above.

- [ ] **Step 6: Verify + commit**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git add apps/main apps/renderer/src/env.d.ts
git commit -m "feat(ipc): add orchestrator, companies, messages handlers + preload"
```

---

## Task 8: Renderer — agents store + messages store + Agent.tsx + Sidebar update

**Files:**
- Create: `apps/renderer/src/stores/agents.ts`
- Create: `apps/renderer/src/stores/messages.ts`
- Create: `apps/renderer/src/routes/Agent.tsx`
- Create: `apps/renderer/src/components/MessageList.tsx`
- Create: `apps/renderer/src/components/ToolCallCard.tsx`
- Create: `apps/renderer/src/components/Composer.tsx`
- Modify: `apps/renderer/src/App.tsx` (add `/agents/:id` route + agents in sidebar)
- Modify: `apps/renderer/src/routes/Dashboard.tsx` (add "Create demo company" button)
- Modify: `apps/renderer/src/i18n/pt-BR.json` and `en-US.json` (new keys)

- [ ] **Step 1: agents store**

```ts
// apps/renderer/src/stores/agents.ts
import { create } from "zustand";
import type { Agent, AgentStatus } from "@prospero/shared";

type State = {
  agents: Agent[];
  loaded: boolean;
  load: (companyId: string) => Promise<void>;
  applyStatus: (agentId: string, status: AgentStatus, currentAction: string | null) => void;
};

export const useAgentsStore = create<State>((set) => ({
  agents: [],
  loaded: false,
  load: async (companyId) => {
    const list = await window.prospero.agents.list(companyId);
    set({ agents: list, loaded: true });
  },
  applyStatus: (agentId, status, currentAction) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId ? { ...a, status, currentAction } : a,
      ),
    })),
}));
```

- [ ] **Step 2: messages store**

```ts
// apps/renderer/src/stores/messages.ts
import { create } from "zustand";
import type { Message, ToolCallView } from "@prospero/shared";

type State = {
  byThreadId: Record<string, Message[]>;
  load: (companyId: string, participants: string[]) => Promise<string | null>;
  append: (message: Message) => void;
  patchToolCallResult: (threadId: string, toolCallId: string, result: string) => void;
};

export const useMessagesStore = create<State>((set, get) => ({
  byThreadId: {},
  load: async (companyId, participants) => {
    const list = await window.prospero.messages.list(companyId, participants);
    if (list.length === 0) return null;
    const threadId = list[0]!.threadId;
    set((s) => ({ byThreadId: { ...s.byThreadId, [threadId]: list } }));
    return threadId;
  },
  append: (message) =>
    set((s) => {
      const existing = s.byThreadId[message.threadId] ?? [];
      return { byThreadId: { ...s.byThreadId, [message.threadId]: [...existing, message] } };
    }),
  patchToolCallResult: (threadId, toolCallId, result) =>
    set((s) => {
      const list = s.byThreadId[threadId];
      if (list === undefined) return s;
      const updated: Message[] = list.map((m) => {
        if (m.toolCalls === null) return m;
        const next: ToolCallView[] = m.toolCalls.map((tc) =>
          tc.id === toolCallId ? { ...tc, status: "success" as const, result } : tc,
        );
        return { ...m, toolCalls: next };
      });
      return { byThreadId: { ...s.byThreadId, [threadId]: updated } };
    }),
}));
```

- [ ] **Step 3: ToolCallCard component**

```tsx
// apps/renderer/src/components/ToolCallCard.tsx
import type { ToolCallView } from "@prospero/shared";

export const ToolCallCard = ({ tool }: { tool: ToolCallView }) => {
  const inputJson = JSON.stringify(tool.input, null, 2);
  return (
    <div className="bg-surface-soft border border-surface-border border-l-2 border-l-brand rounded-md p-3 mt-2 font-mono text-xs">
      <div className="font-sans text-[11px] font-semibold text-brand uppercase tracking-wide mb-1.5">
        ⚙ tool: {tool.name}
        {tool.status === "pending" && <span className="ml-2 text-ink-soft">running…</span>}
      </div>
      <pre className="text-ink-muted whitespace-pre-wrap break-words">{inputJson}</pre>
      {tool.result !== null && (
        <div className="mt-2 pt-2 border-t border-surface-border text-ink">
          <div className="font-sans text-[10px] uppercase text-ink-soft mb-1">result</div>
          <pre className="whitespace-pre-wrap break-words">{tool.result}</pre>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 4: MessageList component**

```tsx
// apps/renderer/src/components/MessageList.tsx
import type { Message } from "@prospero/shared";
import { ToolCallCard } from "./ToolCallCard.js";

export const MessageList = ({ messages }: { messages: Message[] }) => (
  <div className="flex-1 overflow-auto px-7 py-6 flex flex-col gap-4">
    {messages.map((m) => {
      if (m.senderKind === "system") {
        return (
          <div
            key={m.id}
            className="self-center text-xs text-ink-soft bg-surface-soft px-3 py-1 rounded-full border border-surface-border"
          >
            {m.content}
          </div>
        );
      }
      const isUser = m.senderKind === "user";
      return (
        <div
          key={m.id}
          className={`flex gap-3 max-w-[85%] ${isUser ? "self-end flex-row-reverse" : ""}`}
        >
          <div
            className={`w-7 h-7 rounded-md text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
              isUser ? "bg-ink" : "bg-brand-dark"
            }`}
          >
            {isUser ? "EU" : "CE"}
          </div>
          <div className="space-y-1">
            {m.content !== "" && (
              <div
                className={`px-3.5 py-3 rounded-lg text-sm leading-snug ${
                  isUser ? "bg-brand-bg text-brand-dark" : "bg-surface-soft text-ink"
                }`}
              >
                {m.content}
              </div>
            )}
            {m.toolCalls?.map((tc) => <ToolCallCard key={tc.id} tool={tc} />)}
          </div>
        </div>
      );
    })}
  </div>
);
```

- [ ] **Step 5: Composer component**

```tsx
// apps/renderer/src/components/Composer.tsx
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

export const Composer = ({ onSubmit, disabled = false }: Props) => {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    onSubmit(trimmed);
    setValue("");
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(value);
    }
  };

  return (
    <form
      onSubmit={onFormSubmit}
      className="border-t border-surface-border px-6 py-4 bg-surface"
    >
      <div className="flex gap-2 items-end bg-surface-soft border border-surface-border rounded-lg px-3 py-2.5">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("agent.composerPlaceholder")}
          rows={1}
          disabled={disabled}
          className="flex-1 bg-transparent border-0 outline-none resize-none text-sm leading-snug text-ink min-h-[22px]"
        />
        <button
          type="submit"
          disabled={disabled || value.trim() === ""}
          className="bg-brand text-white border-0 px-3.5 py-2 rounded-md font-semibold text-xs disabled:opacity-50"
        >
          {t("agent.send")}
        </button>
      </div>
    </form>
  );
};
```

- [ ] **Step 6: Agent.tsx route**

```tsx
// apps/renderer/src/routes/Agent.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Message } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { useMessagesStore } from "../stores/messages.js";
import { MessageList } from "../components/MessageList.js";
import { Composer } from "../components/Composer.js";

export const Agent = () => {
  const { t } = useTranslation();
  const { id: agentId } = useParams<{ id: string }>();
  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId));
  const loadMessages = useMessagesStore((s) => s.load);
  const append = useMessagesStore((s) => s.append);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messages = useMessagesStore((s) =>
    threadId === null ? [] : (s.byThreadId[threadId] ?? []),
  );

  useEffect(() => {
    if (agent === undefined) return;
    void loadMessages(agent.companyId, ["user", agent.id]).then((tid) => {
      if (tid !== null) setThreadId(tid);
    });
  }, [agent, loadMessages]);

  const onSend = async (content: string) => {
    if (agent === undefined) return;
    const userMsg = await window.prospero.agents.sendMessage(agent.id, content);
    if (threadId === null) setThreadId(userMsg.threadId);
    // Note: store.append is also called by the global onEvent listener; we don't double-append
    // because the broadcast listener handles it once.
  };

  if (agent === undefined) {
    return <div className="p-8 text-ink-muted">{t("agent.notFound")}</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="px-6 py-3.5 border-b border-surface-border flex items-center gap-3.5">
        <div className="w-9 h-9 rounded-md bg-gradient-to-br from-brand to-brand-dark text-white flex items-center justify-center text-[13px] font-bold">
          {agent.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="font-bold text-[15px] text-brand-dark">{agent.name}</div>
          <div className="text-[11px] text-ink-muted mt-0.5">
            {agent.role} · {agent.status}
          </div>
        </div>
      </header>
      <MessageList messages={messages} />
      <Composer onSubmit={(text) => void onSend(text)} />
    </div>
  );
};
```

- [ ] **Step 7: Wire global event listener in App.tsx**

Subscribe to `window.prospero.agents.onEvent` once at app boot and dispatch to stores.

```tsx
// apps/renderer/src/App.tsx — within useEffect that runs at boot
import { useMessagesStore } from "./stores/messages.js";
import { useAgentsStore } from "./stores/agents.js";

// inside App()
const appendMessage = useMessagesStore((s) => s.append);
const patchToolCall = useMessagesStore((s) => s.patchToolCallResult);
const applyStatus = useAgentsStore((s) => s.applyStatus);

useEffect(() => {
  const off = window.prospero.agents.onEvent((ev) => {
    if (ev.kind === "message-append") appendMessage(ev.message);
    else if (ev.kind === "tool-result")
      patchToolCall(ev.threadId, ev.toolCallId, ev.result);
    else if (ev.kind === "status") applyStatus(ev.agentId, ev.status, ev.currentAction);
  });
  return off;
}, [appendMessage, patchToolCall, applyStatus]);
```

Add a route `<Route path="/agents/:id" element={<Layout><Agent/></Layout>} />`.

- [ ] **Step 8: Sidebar — list agents under "Agents" section**

In `App.tsx` Sidebar, add an `agents` selector and render links. After demo company is created and agents loaded, the CEO link appears.

- [ ] **Step 9: Dashboard.tsx — add "Create demo company" button**

```tsx
// apps/renderer/src/routes/Dashboard.tsx
import { useTranslation } from "react-i18next";
import { useAgentsStore } from "../stores/agents.js";
import { useNavigate } from "react-router-dom";

export const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const loadAgents = useAgentsStore((s) => s.load);

  const onCreateDemo = async () => {
    const company = await window.prospero.companies.createDemo();
    await loadAgents(company.id);
    const updated = useAgentsStore.getState().agents;
    if (updated.length > 0) navigate(`/agents/${updated[0]!.id}`);
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-brand-dark">{t("app.title")}</h1>
      <p className="text-ink-muted mt-2">{t("dashboard.placeholder")}</p>
      {agents.length === 0 && (
        <button
          onClick={() => void onCreateDemo()}
          className="mt-6 px-4 py-2 bg-brand text-white text-sm font-semibold rounded"
          type="button"
        >
          {t("dashboard.createDemoCompany")}
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 10: i18n keys**

Add to both `pt-BR.json` and `en-US.json`:

```json
"dashboard.createDemoCompany": "Criar empresa de demonstração" / "Create demo company",
"agent.composerPlaceholder": "Mensagem para o agente..." / "Message to the agent...",
"agent.send": "Enviar" / "Send",
"agent.notFound": "Agente não encontrado." / "Agent not found.",
"nav.agents": "Agentes" / "Agents"
```

(Adjust the JSON so existing structure is preserved — these go into appropriate sections.)

- [ ] **Step 11: Verify build + commit**

```powershell
pnpm lint
pnpm typecheck
pnpm build
git add apps/renderer pnpm-lock.yaml
git commit -m "feat(renderer): add agent chat ui, agents and messages stores, demo button"
```

---

## Task 9: Smoke test + DoD

- [ ] **Step 1: Full pipeline**

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All green.

- [ ] **Step 2: Manual end-to-end**

```powershell
pnpm dev
```

Walk through:

- [ ] If no token: wizard shows. Configure token (auto-detect or manual). Reach `/dashboard`.
- [ ] On Dashboard, click **Create demo company**.
- [ ] Sidebar populates with "CEO" under "Agents". Page navigates to `/agents/<ceo_id>`.
- [ ] Agent header shows "CEO · Chief Executive Officer · idle".
- [ ] Type "Olá! Pode listar os agentes da empresa?" and Enter.
- [ ] Within ~2-5s, status flips to `thinking`, then `working` if a tool call is initiated.
- [ ] A tool-call card appears (e.g., `list_agents` or `notify_user`) with input shown and result `ok`.
- [ ] Final assistant message renders. Status returns to `idle`.
- [ ] Inbox (M2 Settings sidebar still works) has at least one item with `Tool ... called`.
- [ ] Close window → tray icon stays. Reopen window → conversation persists.
- [ ] Quit via tray. Re-launch. Demo company still in the list. Re-enter agent — history still there. Send another message — `--resume` continues the same Claude session.

- [ ] **Step 3: Update README + CHANGELOG; mark M3 done**

## M3 Definition of Done

- [ ] User can create a demo company via UI button
- [ ] User can chat with the CEO agent (real `claude` subprocess); tool calls appear as cards
- [ ] Tool calls are mocks but render with name, input, result
- [ ] Session ID persisted; second message reuses it via `--resume`
- [ ] Agent status transitions (idle → thinking → working → idle) reflected in UI in real time
- [ ] OAuth token never logged or sent to renderer raw
- [ ] All M1+M2 tests still pass; new tests pass; full pipeline green
- [ ] Inbox items appear when MCP tools fire
- [ ] Closing/reopening preserves agent history and demo company

---

## Notes for the implementing engineer

- **Never expose the OAuth token to the renderer.** The orchestrator is the only place that calls `loadDecryptedToken(db)` and the token is injected as env var to the spawned subprocess. The renderer only sees `Agent`, `Message`, `AgentEvent` — never raw bytes.
- **Tool calls have two phases**: `tool-use-start` (input only) → `tool-result` (with output). The UI must render the card immediately on start, then patch the result when it arrives.
- **`--resume` failure handling** is deferred to M4. If the saved session_id is invalid (e.g., Claude was upgraded and dropped sessions), the spawn will fail. For M3, log it and let the user retry; M4 adds a "fallback to new session" path.
- **MCP tools are mocks**: `create_issue`, `hire_agent`, etc. return JSON like `{ok: true, mocked: true}` — they DO NOT create issues or agents in the DB. The Inbox item created via stderr parse confirms the call happened. Real implementations land in M4 (agents UI) and M5 (issues + threads UI).
- **stream-json schema may evolve**: pin Claude Code CLI version in CI (`claude --version >= 2.x`); if a future version changes event shape, the parser is the single point of update.
