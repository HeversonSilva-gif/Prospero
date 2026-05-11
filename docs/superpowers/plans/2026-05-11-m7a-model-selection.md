# M7-A · Model Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que cada agente rode com um modelo Claude escolhido pelo usuário (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / custom id), e definir um default global para novos hires.

**Architecture:** Adicionar coluna `agents.model` via migration 0003. Passar `--model` no spawn do claude CLI em `buildClaudeArgs`. Adicionar campo `defaultModelForNewAgents` no `AppSettings` (já é JSON blob via zod schema). Settings UI ganha dropdown. `hire_agent` MCP tool lê o default da settings. Sem UI por-agente nesse PR (vem em PR-C com right panel).

**Tech Stack:** TypeScript · better-sqlite3 · zod · React · Electron IPC · vitest

**Spec:** [docs/superpowers/specs/2026-05-11-m7-roles-model-org-design.md](../specs/2026-05-11-m7-roles-model-org-design.md) §1 PR-A, §2 schema, §4.1 spawn, §5.5 settings UI

**Out of scope (PR-B, PR-C):** seed de role_templates, hard-gate via `--allowedTools`, right panel em /agents/:id, /org, /skills, change-role/change-model em runtime, restart de runner em config change.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `apps/main/src/db/migrations/0003_m7_roles_model.sql` | create | Adiciona `agents.model` + `role_templates.default_model` + index `idx_agents_template` |
| `packages/shared/src/types/agent.ts` | modify | Campo `model: string` no `Agent` |
| `packages/shared/src/types/settings.ts` | modify | Campo `defaultModelForNewAgents: string` no `AppSettings` + constante `DEFAULT_MODEL` |
| `apps/main/src/settings/schema.ts` | modify | Adiciona `defaultModelForNewAgents` no `AppSettingsSchema` + validação regex |
| `apps/main/src/agents/repository.ts` | modify | `Row.model`, `rowToAgent` retorna model, `CreateAgentInput` aceita `model?`, INSERT inclui model |
| `apps/main/src/agents/seed.ts` | modify | `createCEOAgent` passa `model` opcional |
| `apps/main/src/mcp/tools.ts` | modify | `hire_agent` lê `settings.defaultModelForNewAgents` e passa pro repo |
| `apps/main/src/orchestrator/lifecycle.ts` | modify | `buildClaudeArgs` adiciona `--model <agent.model>` |
| `apps/renderer/src/routes/Settings.tsx` | modify | Nova section "Default model" com dropdown (presets + custom) |
| `apps/renderer/src/components/ModelDropdown.tsx` | create | Componente reusável (será reusado em PR-C right panel) |
| `apps/renderer/src/i18n/en.ts` | modify | Strings de model section |
| `apps/renderer/src/i18n/ptBR.ts` | modify | Idem |
| `apps/main/tests/db.migration-0003.test.ts` | create | Migration aplica clean; columns existem; defaults corretos |
| `apps/main/tests/agents.repository.test.ts` | modify | Repo retorna `model` e respeita `model` no create |
| `apps/main/tests/settings.schema.test.ts` | modify | Aceita valor válido; rejeita injection-style id |
| `apps/main/tests/orchestrator.lifecycle.test.ts` | modify | `buildClaudeArgs` inclui `--model <expected>` |
| `apps/main/tests/mcp.tools.test.ts` | modify | `hire_agent` usa default das settings |

**Total:** 7 modify · 5 create · ~10-15 tasks.

---

## Task 1: Add `model` to `Agent` type in shared

**Files:**
- Modify: `packages/shared/src/types/agent.ts`

- [ ] **Step 1: Update Agent type**

Open `packages/shared/src/types/agent.ts`. Replace the existing `Agent` type with:

```typescript
export type AgentMode = "supervised" | "auto";
export type AgentStatus = "idle" | "thinking" | "working" | "waiting" | "error";

// Sentinel for allowedProjects representing "explicit no access".
export const NO_ACCESS_SENTINEL = "__none__";

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
  allowedProjects: string[];
  model: string;
};
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @dashboard-agent/shared build`
Expected: PASS. Other packages will fail compile next — that's expected.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/agent.ts
git commit -m "feat(m7a): add model field to Agent type"
```

---

## Task 2: Add `defaultModelForNewAgents` to `AppSettings` + constants

**Files:**
- Modify: `packages/shared/src/types/settings.ts`

- [ ] **Step 1: Update settings type**

Open `packages/shared/src/types/settings.ts`. Replace with:

```typescript
export type Language = "pt-BR" | "en-US";
export type Theme = "light" | "dark";

// Default Claude model id used when no per-agent override is set and no role
// template-level default applies. Sonnet 4.6 — best $/token for general use.
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

// Known preset model ids exposed in the Settings UI dropdown. Custom ids are
// also accepted (text input), validated against MODEL_ID_REGEX downstream.
export const CLAUDE_MODEL_PRESETS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

// Permitted characters in a Claude model id. Prevents command injection when
// the id is shell-spawned with --model. claude.com model ids match this shape.
export const MODEL_ID_REGEX = /^[a-z0-9-]+$/;

export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;
  defaultModelForNewAgents: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
  defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
};
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @dashboard-agent/shared build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/settings.ts
git commit -m "feat(m7a): add defaultModelForNewAgents to AppSettings"
```

---

## Task 3: Migration 0003 SQL

**Files:**
- Create: `apps/main/src/db/migrations/0003_m7_roles_model.sql`

- [ ] **Step 1: Write the failing test**

Create `apps/main/tests/db.migration-0003.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

type ColumnInfo = { name: string; type: string; dflt_value: string | null; notnull: number };

const columnsOf = (db: Database.Database, table: string): ColumnInfo[] =>
  db.pragma(`table_info(${table})`) as ColumnInfo[];

describe("migration 0003 — roles & model", () => {
  it("adds agents.model column with default claude-sonnet-4-6", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnsOf(db, "agents");
    const model = cols.find((c) => c.name === "model");
    expect(model).toBeDefined();
    expect(model?.type.toUpperCase()).toBe("TEXT");
    expect(model?.notnull).toBe(1);
    expect(model?.dflt_value).toContain("claude-sonnet-4-6");
  });

  it("adds role_templates.default_model column", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnsOf(db, "role_templates");
    const def = cols.find((c) => c.name === "default_model");
    expect(def).toBeDefined();
    expect(def?.type.toUpperCase()).toBe("TEXT");
    expect(def?.notnull).toBe(1);
  });

  it("creates idx_agents_template index", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agents_template'")
      .get();
    expect(idx).toBeDefined();
  });

  it("existing agents inserted before migration get the default model on backfill", () => {
    // Simulate older DB by applying only migration 0001/0002 (we don't have a
    // way to roll-forward stepwise, so just apply all and insert with model
    // unset to verify the column DEFAULT kicks in via the NOT NULL DEFAULT).
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, current_action, created_at, updated_at)
       VALUES ('a1', 'c1', 'X', 'x', '', '[]', '[]', 'supervised', 0, 'idle', NULL, 0, 0)`,
    ).run();
    const row = db.prepare("SELECT model FROM agents WHERE id = 'a1'").get() as { model: string };
    expect(row.model).toBe("claude-sonnet-4-6");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @dashboard-agent/main test -- db.migration-0003`
Expected: FAIL — `model` column not defined.

- [ ] **Step 3: Create the migration SQL**

Create `apps/main/src/db/migrations/0003_m7_roles_model.sql`:

```sql
-- 0003_m7_roles_model.sql — M7 model selection + roles scaffold
-- Adds:
--   * agents.model — Claude model id used at spawn (passed as --model)
--   * role_templates.default_model — default model when role applied to a new agent
--   * idx_agents_template — fast lookup for "agents using role X" in /skills page

ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';

ALTER TABLE role_templates ADD COLUMN default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';

CREATE INDEX IF NOT EXISTS idx_agents_template ON agents(template_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @dashboard-agent/main test -- db.migration-0003`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full migrations test to verify no regression**

Run: `pnpm -F @dashboard-agent/main test -- db.migrations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/db/migrations/0003_m7_roles_model.sql apps/main/tests/db.migration-0003.test.ts
git commit -m "feat(m7a): migration 0003 — agents.model + role_templates.default_model"
```

---

## Task 4: Update `AppSettingsSchema` with model validation

**Files:**
- Modify: `apps/main/src/settings/schema.ts`
- Modify: `apps/main/tests/settings.schema.test.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/main/tests/settings.schema.test.ts` and append (after existing tests):

```typescript
import { DEFAULT_CLAUDE_MODEL } from "@dashboard-agent/shared";

describe("AppSettingsSchema — defaultModelForNewAgents", () => {
  it("accepts a valid Claude model id", () => {
    const out = parseSettings({
      language: "en-US",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: "claude-opus-4-7",
    });
    expect(out.defaultModelForNewAgents).toBe("claude-opus-4-7");
  });

  it("falls back to DEFAULT_CLAUDE_MODEL when missing", () => {
    const out = parseSettings({ language: "en-US", theme: "light", workspaceCwd: null });
    expect(out.defaultModelForNewAgents).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("rejects model id with shell metacharacters (command injection guard)", () => {
    const out = parseSettings({
      language: "en-US",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: "claude-sonnet-4-6; rm -rf /",
    });
    // Invalid id → falls back to default, not the injected one
    expect(out.defaultModelForNewAgents).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("rejects empty string", () => {
    const out = parseSettings({
      language: "en-US",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: "",
    });
    expect(out.defaultModelForNewAgents).toBe(DEFAULT_CLAUDE_MODEL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @dashboard-agent/main test -- settings.schema`
Expected: FAIL — schema doesn't have the field.

- [ ] **Step 3: Update schema**

Open `apps/main/src/settings/schema.ts`. Replace with:

```typescript
import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  DEFAULT_CLAUDE_MODEL,
  MODEL_ID_REGEX,
  type AppSettings,
} from "@dashboard-agent/shared";

export const AppSettingsSchema = z.object({
  language: z.enum(["pt-BR", "en-US"]),
  theme: z.enum(["light", "dark"]),
  workspaceCwd: z.string().nullable().default(null),
  defaultModelForNewAgents: z.string().regex(MODEL_ID_REGEX).default(DEFAULT_CLAUDE_MODEL),
});

const PartialAppSettingsSchema = AppSettingsSchema.partial();

export const parseSettings = (raw: unknown): AppSettings => {
  const result = PartialAppSettingsSchema.safeParse(raw);
  if (!result.success) return { ...DEFAULT_SETTINGS };
  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  if (result.data.language !== undefined) merged.language = result.data.language;
  if (result.data.theme !== undefined) merged.theme = result.data.theme;
  if (result.data.workspaceCwd !== undefined) merged.workspaceCwd = result.data.workspaceCwd;
  if (result.data.defaultModelForNewAgents !== undefined) {
    merged.defaultModelForNewAgents = result.data.defaultModelForNewAgents;
  }
  return merged;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @dashboard-agent/main test -- settings.schema`
Expected: PASS (4 new + all prior tests).

- [ ] **Step 5: Run settings repository test (no change, but verify regression)**

Run: `pnpm -F @dashboard-agent/main test -- settings.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/main/src/settings/schema.ts apps/main/tests/settings.schema.test.ts
git commit -m "feat(m7a): AppSettings.defaultModelForNewAgents + regex validation"
```

---

## Task 5: Read `model` in agents repository

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/tests/agents.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/main/tests/agents.repository.test.ts` and append:

```typescript
describe("AgentsRepository — model field", () => {
  it("returns model field from rowToAgent (default sonnet)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "Eng",
      role: "Engineer",
      systemPrompt: "engineer system prompt long enough",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(a.model).toBe("claude-sonnet-4-6");
  });

  it("accepts model in CreateAgentInput", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "Boss",
      role: "CEO",
      systemPrompt: "ceo system prompt long enough",
      mode: "supervised",
      alwaysOn: false,
      model: "claude-opus-4-7",
    });
    expect(a.model).toBe("claude-opus-4-7");
  });
});
```

(Assumes the file already imports `Database`, `applyMigrations`, `createAgentsRepository`. If not, copy from top of file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @dashboard-agent/main test -- agents.repository`
Expected: FAIL — Agent type missing `model`.

- [ ] **Step 3: Update repository**

Open `apps/main/src/agents/repository.ts`. Replace the relevant sections:

```typescript
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { DEFAULT_CLAUDE_MODEL, type Agent, type AgentMode, type AgentStatus } from "@dashboard-agent/shared";

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
  model: string;
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
  allowedProjects: JSON.parse(r.allowed_projects_json) as string[],
  model: r.model,
});

export type CreateAgentInput = {
  companyId: string;
  name: string;
  role: string;
  systemPrompt: string;
  mode: AgentMode;
  alwaysOn: boolean;
  model?: string;
};

export type AgentsRepository = {
  create(input: CreateAgentInput): Agent;
  getById(id: string): Agent | null;
  listByCompany(companyId: string): Agent[];
  updateStatus(id: string, patch: { status: AgentStatus; currentAction: string | null }): void;
  setSessionId(id: string, sessionId: string): void;
  clearSessionId(id: string): void;
  setAllowedProjects(id: string, projectIds: string[]): void;
};

export const createAgentsRepository = (db: Database.Database): AgentsRepository => {
  const insert = db.prepare(`
    INSERT INTO agents (id, company_id, name, role, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, current_action, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', '[]', ?, ?, 'idle', NULL, ?, ?, ?)
  `);
  const byId = db.prepare("SELECT * FROM agents WHERE id = ?");
  const byCompany = db.prepare("SELECT * FROM agents WHERE company_id = ? ORDER BY created_at ASC");
  const updateStatusStmt = db.prepare(
    "UPDATE agents SET status = ?, current_action = ?, updated_at = ? WHERE id = ?",
  );
  const setSessionStmt = db.prepare(
    "UPDATE agents SET claude_session_id = ?, updated_at = ? WHERE id = ?",
  );
  const clearSessionStmt = db.prepare(
    "UPDATE agents SET claude_session_id = NULL, updated_at = ? WHERE id = ?",
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
        input.model ?? DEFAULT_CLAUDE_MODEL,
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
    clearSessionId(id) {
      clearSessionStmt.run(Date.now(), id);
    },
    setAllowedProjects(id, projectIds) {
      db.prepare("UPDATE agents SET allowed_projects_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(projectIds),
        Date.now(),
        id,
      );
    },
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @dashboard-agent/main test -- agents.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/repository.ts apps/main/tests/agents.repository.test.ts
git commit -m "feat(m7a): agents repository reads/writes model field"
```

---

## Task 6: Pass `--model` in `buildClaudeArgs`

**Files:**
- Modify: `apps/main/src/orchestrator/lifecycle.ts`
- Modify: `apps/main/tests/orchestrator.lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/main/tests/orchestrator.lifecycle.test.ts`. Append inside `describe("buildClaudeArgs", ...)`:

```typescript
  it("includes --model from agent.model (default sonnet)", () => {
    const args = buildClaudeArgs(baseAgent, "/tmp/mcp.json");
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("claude-sonnet-4-6");
  });

  it("respects per-agent model override (e.g. opus)", () => {
    const args = buildClaudeArgs(
      { ...baseAgent, model: "claude-opus-4-7" },
      "/tmp/mcp.json",
    );
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("claude-opus-4-7");
  });
```

Also update the `baseAgent` fixture at the top of the file to include the new field:

```typescript
const baseAgent: Agent = {
  id: "agent_1",
  companyId: "co_1",
  name: "CEO",
  role: "Chief Executive Officer",
  systemPrompt: "You are CEO.",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
};
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @dashboard-agent/main test -- orchestrator.lifecycle`
Expected: FAIL on `--model` assertions; also type compile errors on baseAgent if not updated.

- [ ] **Step 3: Update buildClaudeArgs**

Open `apps/main/src/orchestrator/lifecycle.ts`. Locate `buildClaudeArgs` (~line 128) and replace the args array start:

```typescript
export const buildClaudeArgs = (agent: Agent, mcpConfigPath: string): string[] => {
  const args = [
    "--system-prompt",
    buildAgentSystemPrompt(agent.systemPrompt),
    "--model",
    agent.model,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    "--permission-mode",
    "default",
    "--permission-prompt-tool",
    "mcp__dashboard__request_permission",
  ];
  if (agent.claudeSessionId !== null) {
    args.push("--resume", agent.claudeSessionId);
  }
  return args;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @dashboard-agent/main test -- orchestrator.lifecycle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/lifecycle.ts apps/main/tests/orchestrator.lifecycle.test.ts
git commit -m "feat(m7a): buildClaudeArgs passes --model from agent.model"
```

---

## Task 7: `hire_agent` MCP tool reads default from settings

**Files:**
- Modify: `apps/main/src/mcp/tools.ts`
- Modify: `apps/main/tests/mcp.tools.test.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/main/tests/mcp.tools.test.ts`. Find the `hire_agent` describe block (search "hire_agent"). Append:

```typescript
  it("uses settings.defaultModelForNewAgents when no override", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    // CEO seed needed because hire_agent uses ctx.agentId as reports_to default
    const ceo = createCEOAgent(db, "c1");
    // Set the global default to opus
    const settings = createSettingsRepository(db);
    settings.write({ defaultModelForNewAgents: "claude-opus-4-7" });

    const ctx = makeCtx(db, "c1", ceo.id);
    const tool = TOOLS.find((t) => t.name === "hire_agent");
    expect(tool).toBeDefined();
    const result = await tool!.run(
      {
        name: "Eng",
        role: "Engineer",
        system_prompt: "you are an engineer, write good code",
      },
      ctx,
    );
    const parsed = JSON.parse(result) as { id: string };
    const created = createAgentsRepository(db).getById(parsed.id);
    expect(created?.model).toBe("claude-opus-4-7");
  });
```

(Imports needed at top if missing: `createCEOAgent` from `../src/agents/seed.js`, `createSettingsRepository` from `../src/settings/repository.js`, `createAgentsRepository` from `../src/agents/repository.js`, `applyMigrations` from `../src/db/migrations.js`. `makeCtx` is the existing test helper in the file.)

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm -F @dashboard-agent/main test -- mcp.tools`
Expected: FAIL — `created.model` is `claude-sonnet-4-6` (column default), not `claude-opus-4-7` (settings).

- [ ] **Step 3: Update hire_agent**

Open `apps/main/src/mcp/tools.ts`. Find the `hire_agent` tool entry (~line 121). Add `createSettingsRepository` to the imports at the top of the file:

```typescript
import { createSettingsRepository } from "../settings/repository.js";
```

Modify the `run` function:

```typescript
    run: async (
      input: {
        name: string;
        role: string;
        system_prompt: string;
        mode?: "supervised" | "auto";
        reports_to?: string;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const agents = createAgentsRepository(ctx.db);
      const messages = createMessagesRepository(ctx.db);
      const settings = createSettingsRepository(ctx.db).read();
      const agent = agents.create({
        companyId: ctx.companyId,
        name: input.name,
        role: input.role,
        systemPrompt: input.system_prompt,
        mode: input.mode ?? "supervised",
        alwaysOn: false,
        model: settings.defaultModelForNewAgents,
      });
      const reportsTo = input.reports_to ?? ctx.agentId;
      ctx.db.prepare("UPDATE agents SET reports_to = ? WHERE id = ?").run(reportsTo, agent.id);
      messages.ensureThread(ctx.companyId, [ctx.agentId, agent.id]);
      ctx.emit({ kind: "agent.spawn-needed", payload: { agentId: agent.id } });
      return JSON.stringify({ id: agent.id, name: agent.name, role: agent.role });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @dashboard-agent/main test -- mcp.tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/mcp/tools.ts apps/main/tests/mcp.tools.test.ts
git commit -m "feat(m7a): hire_agent reads settings.defaultModelForNewAgents"
```

---

## Task 8: Add i18n strings (en + ptBR)

**Files:**
- Modify: `apps/renderer/src/i18n/en.ts`
- Modify: `apps/renderer/src/i18n/ptBR.ts`

- [ ] **Step 1: Add strings to en.ts**

Open `apps/renderer/src/i18n/en.ts`. Locate the `settings:` block. Add a `model:` section under it (keep your existing structure):

```typescript
  settings: {
    // ... existing keys ...
    model: {
      title: "Default model",
      hint: "Used for new agents you hire. Change does not affect existing agents.",
      preset: "Preset",
      custom: "Custom model id",
      customPlaceholder: "claude-...",
      invalid: "Model id contains invalid characters. Use a-z, 0-9, and hyphens.",
      presetOpus: "Opus 4.7 (best reasoning)",
      presetSonnet: "Sonnet 4.6 (balanced — recommended)",
      presetHaiku: "Haiku 4.5 (fastest, cheapest)",
      saved: "Saved",
    },
  },
```

- [ ] **Step 2: Add strings to ptBR.ts**

Open `apps/renderer/src/i18n/ptBR.ts`. Same structure:

```typescript
  settings: {
    // ... existing keys ...
    model: {
      title: "Modelo padrão",
      hint: "Usado pra novos agentes contratados. Mudança não afeta agentes existentes.",
      preset: "Preset",
      custom: "Model id customizado",
      customPlaceholder: "claude-...",
      invalid: "Model id tem caracteres inválidos. Use a-z, 0-9 e hífens.",
      presetOpus: "Opus 4.7 (melhor raciocínio)",
      presetSonnet: "Sonnet 4.6 (balanceado — recomendado)",
      presetHaiku: "Haiku 4.5 (mais rápido, mais barato)",
      saved: "Salvo",
    },
  },
```

- [ ] **Step 3: Verify i18n coverage test (if exists)**

Run: `pnpm -F @dashboard-agent/renderer test -- i18n` (skip if no such test)
Expected: PASS (both files have parity).

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/i18n/en.ts apps/renderer/src/i18n/ptBR.ts
git commit -m "feat(m7a): i18n strings for default model settings"
```

---

## Task 9: `ModelDropdown` reusable component

**Files:**
- Create: `apps/renderer/src/components/ModelDropdown.tsx`

- [ ] **Step 1: Write the component**

Create `apps/renderer/src/components/ModelDropdown.tsx`:

```typescript
import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { CLAUDE_MODEL_PRESETS, MODEL_ID_REGEX } from "@dashboard-agent/shared";

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

const CUSTOM = "__custom__";

export const ModelDropdown: FC<Props> = ({ value, onChange, disabled = false }) => {
  const { t } = useTranslation();
  const isPreset = (CLAUDE_MODEL_PRESETS as readonly string[]).includes(value);
  const [selectValue, setSelectValue] = useState<string>(isPreset ? value : CUSTOM);
  const [customValue, setCustomValue] = useState<string>(isPreset ? "" : value);
  const [error, setError] = useState<string | null>(null);

  const onSelect = (next: string) => {
    setSelectValue(next);
    setError(null);
    if (next === CUSTOM) {
      // Don't fire onChange until user types a valid value
      return;
    }
    onChange(next);
  };

  const onCustomBlur = () => {
    if (selectValue !== CUSTOM) return;
    const trimmed = customValue.trim();
    if (trimmed === "" || !MODEL_ID_REGEX.test(trimmed)) {
      setError(t("settings.model.invalid"));
      return;
    }
    setError(null);
    onChange(trimmed);
  };

  return (
    <div className="space-y-2">
      <select
        value={selectValue}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm"
      >
        <option value="claude-opus-4-7">{t("settings.model.presetOpus")}</option>
        <option value="claude-sonnet-4-6">{t("settings.model.presetSonnet")}</option>
        <option value="claude-haiku-4-5-20251001">{t("settings.model.presetHaiku")}</option>
        <option value={CUSTOM}>{t("settings.model.custom")}</option>
      </select>
      {selectValue === CUSTOM && (
        <input
          type="text"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onBlur={onCustomBlur}
          placeholder={t("settings.model.customPlaceholder")}
          disabled={disabled}
          className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
        />
      )}
      {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
    </div>
  );
};
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm -F @dashboard-agent/renderer build`
Expected: PASS (build succeeds; component not yet imported anywhere — that's next task).

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/components/ModelDropdown.tsx
git commit -m "feat(m7a): ModelDropdown component (presets + custom + validation)"
```

---

## Task 10: Settings UI — "Default model" section

**Files:**
- Modify: `apps/renderer/src/routes/Settings.tsx`

- [ ] **Step 1: Add settings store wiring (read/update)**

First verify the existing settings store. Search for it:

Run: `pnpm -F @dashboard-agent/renderer test -- settings.store` (if exists)

Open `apps/renderer/src/stores/settings.ts` (likely path; if it doesn't exist, the Settings.tsx page may use direct IPC calls — fallback to `window.dashboardAgent.settings.get/update`).

If the store needs a new field for `defaultModelForNewAgents`, it's already covered by reading the whole `AppSettings` blob — no schema change needed. Just make sure the renderer can read/write the field.

- [ ] **Step 2: Update Settings.tsx**

Open `apps/renderer/src/routes/Settings.tsx`. Add imports at the top:

```typescript
import { useEffect, useState } from "react";
import { ModelDropdown } from "../components/ModelDropdown.js";
import { DEFAULT_CLAUDE_MODEL } from "@dashboard-agent/shared";
```

Add a new section above the workspace deprecated note. Inside the component, add state + load:

```typescript
  const [defaultModel, setDefaultModel] = useState<string>(DEFAULT_CLAUDE_MODEL);
  const [modelSaved, setModelSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const settings = await window.dashboardAgent.settings.get();
      setDefaultModel(settings.defaultModelForNewAgents);
    })();
  }, []);

  const saveModel = async (next: string) => {
    await window.dashboardAgent.settings.update({ defaultModelForNewAgents: next });
    setDefaultModel(next);
    setModelSaved(true);
    window.setTimeout(() => setModelSaved(false), 2000);
  };
```

In the JSX, add this section between the auth section and the workspace section:

```tsx
      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          {t("settings.model.title")}
        </h2>
        <p className="text-xs text-ink-muted mb-3">{t("settings.model.hint")}</p>
        <ModelDropdown value={defaultModel} onChange={(v) => void saveModel(v)} />
        {modelSaved && (
          <p className="text-xs text-semantic-success mt-2">{t("settings.model.saved")}</p>
        )}
      </section>
```

- [ ] **Step 3: Verify renderer builds**

Run: `pnpm -F @dashboard-agent/renderer build`
Expected: PASS.

- [ ] **Step 4: Manual smoke (dev mode)**

Run: `pnpm dev`
Open the app, navigate to Settings.
Verify:
- "Default model" section appears with Sonnet 4.6 selected.
- Switching to Opus 4.7 → "Saved" toast appears for 2s.
- Switching to "Custom model id" reveals text input.
- Typing `claude-test-123` and blurring → "Saved" toast.
- Typing `claude; rm` and blurring → error message; not saved.
- Reopen Settings → last valid choice persists.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/routes/Settings.tsx
git commit -m "feat(m7a): Settings UI — Default model dropdown wired"
```

---

## Task 11: Regression suite & roadmap update

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: 185 + ~10 new tests passing. Zero failures.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 4: Verify token-leak regression still green**

Run: `pnpm -F @dashboard-agent/main test -- auth.token-redact ipc.handlers`
Expected: PASS — `model` field carrying through IPC does not leak OAuth token.

- [ ] **Step 5: Verify M6 token budget regression**

Run: `pnpm -F @dashboard-agent/main test -- m6-token-budget`
Expected: PASS (skip-while-zero still applies; this is the baseline marker).

- [ ] **Step 6: Update ROADMAP.md**

Open `ROADMAP.md`. Update the "M7 — Org Chart + Skills" section: add a "(in progress: PR-A model selection merged)" annotation, and mark the `[ ] Adicionar coluna agents.model` checkbox to `[x]`.

Update header `**Última atualização:**` to `2026-05-11 (M7-A PR-A — model selection merged)`.

- [ ] **Step 7: Final commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): M7-A PR-A — model selection merged"
```

---

## Acceptance criteria checklist

- [ ] Migration 0003 applies clean on fresh DB and on M6 DB (via `applyMigrations`).
- [ ] `agents.model` defaults to `'claude-sonnet-4-6'` for existing rows.
- [ ] `--model` appears in `buildClaudeArgs` output with correct value.
- [ ] `hire_agent` MCP tool creates agents with `model = settings.defaultModelForNewAgents`.
- [ ] Settings UI shows current default; saves to DB; rejects invalid model ids.
- [ ] All existing tests pass (185 → ~195 with new tests).
- [ ] Zero lint/typecheck errors.
- [ ] Manual smoke in dev mode: settings page loads, dropdown switches, custom id with invalid chars blocked.

---

## Out of scope (reminder)

These come in **PR-B** (roles + hard-gate) and **PR-C** (org + right panel):
- Seed of `role_templates` rows (CEO, Engineer, QA, Designer, PM).
- Backfill of CEO with `template_id` + opus model.
- `--allowedTools` in `buildClaudeArgs`.
- `skillsToTools` mapping in shared.
- Per-agent model change UI (right panel `/agents/:id`).
- Restart runner on model change.
- `/org` route, `/skills` route, sidebar links.
- `role_template_id` param in `hire_agent`.

---

## Self-review notes (writing-plans)

**Spec coverage** — all PR-A items in spec §1 + §2 + §4.1 + §5.5 mapped to tasks:
- Migration 0003 ✓ (Task 3)
- `--model` in spawn ✓ (Task 6)
- Settings default ✓ (Tasks 4, 8, 9, 10)
- `hire_agent` reads settings ✓ (Task 7)
- Regex validation ✓ (Tasks 2, 4)

**Placeholder scan** — no TBDs, all code blocks complete, exact paths given.

**Type consistency** — `model` field added consistently to `Agent`, `Row`, `CreateAgentInput`, repository, schema, settings. `DEFAULT_CLAUDE_MODEL` constant reused everywhere.

**Ambiguity** — none open. Hire flow uses settings; existing agents keep DB default; user-side override comes in PR-C.
