# M7-B · Roles + Skills Hard-Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed 5 role templates (CEO, Engineer, QA, Designer, PM) and enforce a hard-gate on agent tool surface via `--allowedTools` in the claude CLI spawn, derived from each agent's `skills_json`. Add a `/skills` route to browse roles read-only.

**Architecture:** A pure `skillsToTools()` mapping in `packages/shared` translates canonical skill IDs (e.g. `shell`, `fs-write`, `delegation`) into the flat list of Claude tool names (Bash, Edit, Write, MCP tool names). At spawn time, `buildClaudeArgs` reads `agent.skills_json`, resolves the tool list, auto-injects the mandatory `chat` skill (which carries `request_permission`), and passes the result as `--allowedTools`. A `chat` safety-net ensures the permission-prompt-tool always works even if skills_json is corrupted. A post-migration script (0004) seeds the 5 roles and backfills the CEO agent's `skills_json` + `model` from the CEO role.

**Tech Stack:** TypeScript · better-sqlite3 · React + zustand · Electron IPC · vitest

**Spec:** [docs/superpowers/specs/2026-05-11-m7-roles-model-org-design.md](../specs/2026-05-11-m7-roles-model-org-design.md) §1 PR-B, §2.2 post-migration, §3 roles + mapping, §4.1 spawn args, §4.2 hire_agent, §5.2 /skills page, §6 tests, §7 security.

**Builds on PR-A (`0caa31b`, merged):**

- `agents.model` column exists.
- `role_templates.default_model` column exists.
- `Agent.model` and `defaultModelForNewAgents` settings work end-to-end.
- `--model` already passed in `buildClaudeArgs`.

**Out of scope (PR-C and beyond):**

- `/org` route and right panel in `/agents/:id` — PR-C.
- Edit/change-role from UI — PR-C.
- Per-agent skill drag-drop — never (spec says role-based only in v1).
- Runtime restart of agents when their skills change — covered by PR-C's restart-on-config-change pattern.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `packages/shared/src/types/agent.ts` | modify | Add `skills: string[]` and `templateId: string \| null` to `Agent` |
| `packages/shared/src/types/role.ts` | create | New `RoleTemplate` + `RoleDetail` types |
| `packages/shared/src/types/index.ts` | modify | Re-export `role` types |
| `packages/shared/src/skills.ts` | create | Skill catalog + `skillsToTools()` + `ensureChatSkill()` + `KNOWN_CLAUDE_TOOLS` |
| `packages/shared/src/index.ts` | modify | Re-export skills module |
| `packages/shared/src/ipc-channels.ts` | modify | Add `ROLES_LIST`, `ROLES_GET` constants |
| `packages/shared/tests/skills.test.ts` | create | Unit tests for skillsToTools, ensureChatSkill, KNOWN_CLAUDE_TOOLS coverage |
| `apps/main/src/db/post-migrations/0004.ts` | create | Seed 5 roles + backfill CEO + backfill orphans |
| `apps/main/src/db/post-migrations/index.ts` | modify | Register 0004 |
| `apps/main/tests/db.post-migration-0004.test.ts` | create | Tests for seed + backfill behavior |
| `apps/main/src/agents/role-templates-repository.ts` | create | Read-only repo: `listAll`, `getById`, `agentsUsing` |
| `apps/main/tests/role-templates.repository.test.ts` | create | Repo unit tests |
| `apps/main/src/agents/repository.ts` | modify | Row gets `skills_json`, `template_id` mapped to `skills` / `templateId` |
| `apps/main/tests/agents.repository.test.ts` | modify | Tests for skills + templateId read/write |
| `apps/main/src/orchestrator/system-prompt.ts` | modify | `buildAgentSystemPrompt(prompt, skills)` with skill-list block |
| `apps/main/src/orchestrator/lifecycle.ts` | modify | `buildClaudeArgs` adds `--allowedTools` |
| `apps/main/tests/orchestrator.lifecycle.test.ts` | modify | Tests for `--allowedTools` correctness |
| `apps/main/src/mcp/tools.ts` | modify | `hire_agent` accepts `role_template_id`; resolves skills + model from role |
| `apps/main/tests/mcp.tools.test.ts` | modify | Tests for hire_agent with role_template_id |
| `apps/main/src/ipc/roles-handlers.ts` | create | IPC handlers for `roles:list` / `roles:get` |
| `apps/main/src/ipc/handlers.ts` | modify | Register roles handlers |
| `apps/main/src/ipc/preload.ts` | modify | Expose `dashboardAgent.roles` API |
| `apps/main/tests/ipc.roles-handlers.test.ts` | create | Integration tests |
| `apps/renderer/src/i18n/en-US.json` | modify | `skills.*` keys |
| `apps/renderer/src/i18n/pt-BR.json` | modify | Same |
| `apps/renderer/src/stores/roles.ts` | create | zustand store: `roles[]`, `selected`, `load()`, `select()` |
| `apps/renderer/src/components/skills/RoleListItem.tsx` | create | List item with icon, name, agent count |
| `apps/renderer/src/components/skills/RoleDetail.tsx` | create | Detail panel: header + tool chips by skill + agents using |
| `apps/renderer/src/routes/Skills.tsx` | create | Master/detail page mirroring `Projects.tsx` |
| `apps/renderer/src/App.tsx` | modify | Register `/skills` route + sidebar link |
| `ROADMAP.md` | modify | Mark M7-B done at end |

**Total:** 15 create · 14 modify · 16 tasks.

---

## Task 1: Add `skills` + `templateId` to `Agent` type

**Files:**
- Modify: `packages/shared/src/types/agent.ts`

- [ ] **Step 1: Update Agent type**

Read `packages/shared/src/types/agent.ts` first. The current shape ends with `model: string;`. Replace the entire `Agent` type with:

```typescript
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
  skills: string[];
  templateId: string | null;
};
```

Preserve the existing `AgentMode`, `AgentStatus`, and `NO_ACCESS_SENTINEL` exports (with their existing comment block) — only the `Agent` type changes.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm -F @dashboard-agent/shared typecheck
```
Expected: PASS. Downstream packages will fail typecheck — that's expected; subsequent tasks fix them.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/agent.ts
git commit -m "feat(m7b): add skills + templateId to Agent type"
```

---

## Task 2: Create `RoleTemplate` types

**Files:**
- Create: `packages/shared/src/types/role.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Create the new types file**

Create `packages/shared/src/types/role.ts`:

```typescript
// RoleTemplate is the seeded blueprint for hiring an agent. Stored in the
// `role_templates` DB table (one row per canonical role). Skills are canonical
// IDs from packages/shared/src/skills.ts — each skill resolves to a set of
// Claude tool names at spawn time.
export type RoleTemplate = {
  id: string;
  name: string;
  description: string;
  defaultSystemPrompt: string;
  defaultSkills: string[];
  defaultModel: string;
  icon: string | null;
};

// RoleDetail extends RoleTemplate with derived data shown in the /skills UI:
// the resolved flat list of Claude tool names and which agents currently use
// the role. Agents-using is a small slice for the right-panel listing.
export type RoleDetail = RoleTemplate & {
  resolvedTools: string[];
  agentsUsing: Array<{ id: string; name: string }>;
};
```

- [ ] **Step 2: Re-export from types/index.ts**

Read `packages/shared/src/types/index.ts` first. It probably re-exports each type file (`./agent.js`, `./settings.js`, etc). Add the line `export * from "./role.js";` in the same style.

- [ ] **Step 3: Typecheck**

```bash
pnpm -F @dashboard-agent/shared typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/role.ts packages/shared/src/types/index.ts
git commit -m "feat(m7b): add RoleTemplate + RoleDetail types"
```

---

## Task 3: Create `skills.ts` in shared (skill catalog + mapping)

**Files:**
- Create: `packages/shared/src/skills.ts`
- Create: `packages/shared/tests/skills.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests FIRST**

Create `packages/shared/tests/skills.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  KNOWN_CLAUDE_TOOLS,
  SKILL_CATALOG,
  ensureChatSkill,
  skillsToTools,
  resolveSkillTools,
} from "../src/skills.js";

describe("skill catalog", () => {
  it("includes the 8 canonical skill ids", () => {
    expect(Object.keys(SKILL_CATALOG).sort()).toEqual([
      "chat",
      "delegation",
      "fs-read",
      "fs-write",
      "inbox",
      "issues",
      "shell",
      "web",
    ]);
  });

  it("every built-in tool in KNOWN_CLAUDE_TOOLS is mapped by at least one skill", () => {
    const mapped = new Set<string>();
    for (const skill of Object.values(SKILL_CATALOG)) {
      for (const t of skill.tools) mapped.add(t);
    }
    for (const tool of KNOWN_CLAUDE_TOOLS) {
      expect(mapped.has(tool), `tool "${tool}" has no skill mapping`).toBe(true);
    }
  });
});

describe("ensureChatSkill", () => {
  it("adds 'chat' when missing", () => {
    expect(ensureChatSkill(["shell"]).sort()).toEqual(["chat", "shell"]);
  });

  it("does not duplicate 'chat' when present", () => {
    expect(ensureChatSkill(["chat", "shell"]).sort()).toEqual(["chat", "shell"]);
  });

  it("preserves order otherwise", () => {
    expect(ensureChatSkill(["shell", "fs-read"])).toEqual(["shell", "fs-read", "chat"]);
  });
});

describe("skillsToTools", () => {
  it("returns Bash for shell skill", () => {
    expect(skillsToTools(["shell"])).toContain("Bash");
  });

  it("returns Read, Glob, Grep for fs-read", () => {
    const tools = skillsToTools(["fs-read"]);
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
  });

  it("returns Edit, Write, NotebookEdit for fs-write", () => {
    const tools = skillsToTools(["fs-write"]);
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("NotebookEdit");
  });

  it("returns WebFetch, WebSearch for web", () => {
    const tools = skillsToTools(["web"]);
    expect(tools).toContain("WebFetch");
    expect(tools).toContain("WebSearch");
  });

  it("returns mcp__dashboard__hire_agent etc for delegation", () => {
    const tools = skillsToTools(["delegation"]);
    expect(tools).toContain("mcp__dashboard__hire_agent");
    expect(tools).toContain("mcp__dashboard__message_agent");
    expect(tools).toContain("mcp__dashboard__list_agents");
  });

  it("returns mcp__dashboard__create_issue etc for issues", () => {
    const tools = skillsToTools(["issues"]);
    expect(tools).toContain("mcp__dashboard__create_issue");
    expect(tools).toContain("mcp__dashboard__update_issue");
  });

  it("returns request_permission for chat skill", () => {
    expect(skillsToTools(["chat"])).toEqual(["mcp__dashboard__request_permission"]);
  });

  it("ignores unknown skill ids (does not throw)", () => {
    const tools = skillsToTools(["shell", "totally-fake-skill"]);
    expect(tools).toContain("Bash");
    // Unknown skill silently dropped — tested by absence of throw.
  });

  it("deduplicates when two skills map to overlapping tools (none today, but pattern-test)", () => {
    // Even if two skills both produce Bash, output should only contain Bash once.
    const tools = skillsToTools(["shell", "shell"]);
    const bashCount = tools.filter((t) => t === "Bash").length;
    expect(bashCount).toBe(1);
  });
});

describe("resolveSkillTools (full resolver with chat safety-net)", () => {
  it("auto-injects chat skill if missing", () => {
    const tools = resolveSkillTools(["shell"]);
    expect(tools).toContain("Bash");
    expect(tools).toContain("mcp__dashboard__request_permission");
  });

  it("empty skill list still gets request_permission via chat safety-net", () => {
    expect(resolveSkillTools([])).toEqual(["mcp__dashboard__request_permission"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm -F @dashboard-agent/shared test -- skills.test
```
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `skills.ts`**

Create `packages/shared/src/skills.ts`:

```typescript
// Canonical skill IDs and their resolved Claude tool sets. Modifying this file
// changes what each agent CAN see (the --allowedTools whitelist at spawn time).
// New built-in tools added to Claude CLI must be categorized into a skill here
// — the test "every built-in tool in KNOWN_CLAUDE_TOOLS is mapped" enforces
// this.

// Master list of built-in Claude tools we know about. Kept manually — when
// Claude CLI adds a new tool, add it here AND map it into a skill below.
// Tools internal to the CLI (TodoWrite, ExitPlanMode, etc.) are not listed
// because agents don't need them; they're used by claude itself.
export const KNOWN_CLAUDE_TOOLS = [
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "NotebookEdit",
  "Read",
  "WebFetch",
  "WebSearch",
  "Write",
] as const;

export type SkillId =
  | "chat"
  | "delegation"
  | "fs-read"
  | "fs-write"
  | "inbox"
  | "issues"
  | "shell"
  | "web";

export type SkillDef = {
  id: SkillId;
  description: string;
  tools: string[];
};

export const SKILL_CATALOG: Record<SkillId, SkillDef> = {
  shell: {
    id: "shell",
    description: "Run shell commands via Bash.",
    tools: ["Bash"],
  },
  "fs-read": {
    id: "fs-read",
    description: "Read files, search by glob, search content.",
    tools: ["Read", "Glob", "Grep"],
  },
  "fs-write": {
    id: "fs-write",
    description: "Edit, create, and modify files.",
    tools: ["Edit", "Write", "NotebookEdit"],
  },
  web: {
    id: "web",
    description: "Fetch URLs and search the web.",
    tools: ["WebFetch", "WebSearch"],
  },
  delegation: {
    id: "delegation",
    description: "Hire/fire/message other agents; list active agents; read threads.",
    tools: [
      "mcp__dashboard__hire_agent",
      "mcp__dashboard__fire_agent",
      "mcp__dashboard__list_agents",
      "mcp__dashboard__message_agent",
      "mcp__dashboard__read_thread",
    ],
  },
  issues: {
    id: "issues",
    description: "Create, update, assign, list issues; check status.",
    tools: [
      "mcp__dashboard__create_issue",
      "mcp__dashboard__update_issue",
      "mcp__dashboard__assign_issue",
      "mcp__dashboard__list_issues",
      "mcp__dashboard__check_status",
    ],
  },
  inbox: {
    id: "inbox",
    description: "Notify or report to the user via the inbox.",
    tools: ["mcp__dashboard__notify_user", "mcp__dashboard__report_to_user"],
  },
  chat: {
    id: "chat",
    description: "Permission prompt routing — required for filesystem gate to function.",
    tools: ["mcp__dashboard__request_permission"],
  },
};

// Force-adds the 'chat' skill (needed for --permission-prompt-tool to work) if
// it's missing. Returns a new array; does not mutate input.
export const ensureChatSkill = (skills: string[]): string[] => {
  if (skills.includes("chat")) return [...skills];
  return [...skills, "chat"];
};

// Translates skill IDs into the flat deduplicated list of Claude tool names.
// Unknown skill IDs are silently dropped (logged elsewhere if needed) so a
// stale skills_json from a future version doesn't crash spawn.
export const skillsToTools = (skills: string[]): string[] => {
  const out = new Set<string>();
  for (const id of skills) {
    const def = SKILL_CATALOG[id as SkillId];
    if (def === undefined) continue;
    for (const t of def.tools) out.add(t);
  }
  return Array.from(out);
};

// Full resolver: ensures the chat safety-net and returns the flat tool list.
// This is the function the orchestrator should call when building spawn args.
export const resolveSkillTools = (skills: string[]): string[] => {
  return skillsToTools(ensureChatSkill(skills));
};
```

- [ ] **Step 4: Re-export from shared index**

Read `packages/shared/src/index.ts`. It currently has `export * from "./ipc-channels.js";` and `export * from "./types/index.js";`. Add `export * from "./skills.js";` (preserves the existing two lines).

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm -F @dashboard-agent/shared test -- skills.test
```
Expected: PASS (all ~14 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/skills.ts packages/shared/tests/skills.test.ts packages/shared/src/index.ts
git commit -m "feat(m7b): skill catalog + skillsToTools mapping"
```

---

## Task 4: Update agents repository for `skills` + `templateId`

**Files:**
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/tests/agents.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/main/tests/agents.repository.test.ts`. Inside the existing `describe("AgentsRepository — model field", ...)` block (or as a new describe immediately after — your choice for clarity), append:

```typescript
describe("AgentsRepository — skills + templateId", () => {
  it("returns empty skills + null templateId for a freshly created agent", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "Eng",
      role: "Engineer",
      systemPrompt: "long enough system prompt",
      mode: "supervised",
      alwaysOn: false,
    });
    expect(a.skills).toEqual([]);
    expect(a.templateId).toBeNull();
  });

  it("create() persists skills + templateId when provided", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'X', 0)").run();
    const repo = createAgentsRepository(db);
    const a = repo.create({
      companyId: "c1",
      name: "Eng",
      role: "Engineer",
      systemPrompt: "long enough system prompt",
      mode: "supervised",
      alwaysOn: false,
      skills: ["shell", "fs-write"],
      templateId: "role-engineer",
    });
    expect(a.skills).toEqual(["shell", "fs-write"]);
    expect(a.templateId).toBe("role-engineer");
    // Round-trip via getById to make sure DB persisted both.
    const back = repo.getById(a.id);
    expect(back?.skills).toEqual(["shell", "fs-write"]);
    expect(back?.templateId).toBe("role-engineer");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -C "<wt-or-repo-root>" -F @dashboard-agent/main test -- agents.repository
```
Expected: FAIL — current `Agent` returned by repo lacks `skills` / `templateId`.

- [ ] **Step 3: Modify repository.ts**

Open `apps/main/src/agents/repository.ts`. Apply these changes:

1. **Update `rowToAgent`** to map `r.skills_json` and `r.template_id`:

```typescript
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
  skills: JSON.parse(r.skills_json) as string[],
  templateId: r.template_id,
});
```

2. **Update `CreateAgentInput`** to accept optional `skills` and `templateId`:

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
};
```

3. **Update the prepared INSERT statement** — it currently uses literals `'[]'` for `skills_json` and omits `template_id`. Change to use placeholders so both are settable. Replace the `insert = db.prepare(...)` block with:

```typescript
const insert = db.prepare(`
  INSERT INTO agents (id, company_id, name, role, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, current_action, model, template_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, 'idle', NULL, ?, ?, ?, ?)
`);
```

Now there are 12 placeholders (was 10): id, company_id, name, role, system_prompt, **skills_json**, mode, always_on, model, **template_id**, created_at, updated_at.

4. **Update `create()` to pass the new args** — replace the `insert.run(...)` block:

```typescript
create(input) {
  const id = `agent_${randomUUID()}`;
  const now = Date.now();
  insert.run(
    id,
    input.companyId,
    input.name,
    input.role,
    input.systemPrompt,
    JSON.stringify(input.skills ?? []),
    input.mode,
    input.alwaysOn ? 1 : 0,
    input.model || DEFAULT_CLAUDE_MODEL,
    input.templateId ?? null,
    now,
    now,
  );
  const row = byId.get(id) as Row;
  return rowToAgent(row);
},
```

(Note: the order of `insert.run` args MUST match the SQL placeholder order: id, company_id, name, role, system_prompt, skills_json, mode, always_on, model, template_id, created_at, updated_at.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -F @dashboard-agent/main test -- agents.repository
```
Expected: PASS (all existing + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/repository.ts apps/main/tests/agents.repository.test.ts
git commit -m "feat(m7b): agents repository reads/writes skills + templateId"
```

---

## Task 5: Backfill `Agent` test fixtures with `skills` + `templateId`

**Files:**
- Modify: `apps/main/tests/orchestrator.lifecycle.test.ts`
- Modify: `apps/main/tests/security.gate-projects.test.ts`
- Modify: `apps/main/tests/security.gate.test.ts`
- Modify: `apps/main/tests/security.permission-watcher.test.ts`
- Modify: `apps/main/tests/orchestrator.env.test.ts`
- Modify: `packages/shared/tests/m3-types.test.ts`

- [ ] **Step 1: Run typecheck to see all sites that break**

```bash
pnpm typecheck
```

Expected: errors in the files above (and possibly more). Each error will be `Property 'skills' is missing in type '...' but required in type 'Agent'` or similar for `templateId`.

- [ ] **Step 2: Backfill each fixture**

For each test file that constructs an `Agent` literal, locate the literal and add the two fields at the end (after `model`):

```typescript
skills: [],
templateId: null,
```

The exact line numbers vary — use grep to find them:

```bash
grep -n "model:" apps/main/tests/orchestrator.lifecycle.test.ts apps/main/tests/security.gate-projects.test.ts apps/main/tests/security.gate.test.ts apps/main/tests/security.permission-watcher.test.ts apps/main/tests/orchestrator.env.test.ts packages/shared/tests/m3-types.test.ts
```

For each match, add the two new fields just below the `model:` line.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```
Expected: PASS — same count as before (no behavioral change yet).

- [ ] **Step 5: Commit**

```bash
git add apps/main/tests/orchestrator.lifecycle.test.ts apps/main/tests/security.gate-projects.test.ts apps/main/tests/security.gate.test.ts apps/main/tests/security.permission-watcher.test.ts apps/main/tests/orchestrator.env.test.ts packages/shared/tests/m3-types.test.ts
git commit -m "test(m7b): backfill skills+templateId in Agent test fixtures"
```

---

## Task 6: Update `buildAgentSystemPrompt` to accept skills

**Files:**
- Modify: `apps/main/src/orchestrator/system-prompt.ts`

- [ ] **Step 1: Update the function signature + body**

Read `apps/main/src/orchestrator/system-prompt.ts` first to see the current PREAMBLE block. Then replace the export at the end with:

```typescript
import { resolveSkillTools, ensureChatSkill } from "@dashboard-agent/shared";

// buildAgentSystemPrompt assembles the full system prompt for a spawned agent:
//   1. PREAMBLE — sandbox + delegation contract (project-wide).
//   2. User-defined system prompt (from agent.systemPrompt).
//   3. Skills block — informs the agent which canonical skills it has and the
//      resolved list of Claude tool names that are visible to it. Without this
//      block the agent might attempt tools it cannot see (e.g. Bash without
//      shell skill) and get confused when the tool fails to surface.
export const buildAgentSystemPrompt = (
  userSystemPrompt: string,
  skills: string[],
): string => {
  const effectiveSkills = ensureChatSkill(skills);
  const resolvedTools = resolveSkillTools(skills);
  const skillsBlock = `

---

# Your skills and available tools

You have the following skills: ${effectiveSkills.join(", ")}.

The host has filtered your visible Claude tools to: ${resolvedTools.join(", ")}.

Tools outside this list are not available to you and will fail if you attempt
to call them. If you need a capability you don't have, ask the user to update
your role.
`;
  return PREAMBLE + userSystemPrompt + skillsBlock;
};
```

(Preserve the entire existing `PREAMBLE` constant. Only the import and the export function change.)

- [ ] **Step 2: Typecheck**

```bash
pnpm -F @dashboard-agent/main typecheck
```
Expected: errors in `lifecycle.ts` (which calls `buildAgentSystemPrompt(agent.systemPrompt)` without skills). Task 7 fixes that.

- [ ] **Step 3: Commit**

```bash
git add apps/main/src/orchestrator/system-prompt.ts
git commit -m "feat(m7b): buildAgentSystemPrompt injects skills block"
```

---

## Task 7: Update `buildClaudeArgs` with `--allowedTools`

**Files:**
- Modify: `apps/main/src/orchestrator/lifecycle.ts`
- Modify: `apps/main/tests/orchestrator.lifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/main/tests/orchestrator.lifecycle.test.ts`. Find the `describe("buildClaudeArgs", ...)` block. Append these tests inside it:

```typescript
  it("includes --allowedTools resolved from agent.skills", () => {
    const args = buildClaudeArgs(
      { ...baseAgent, skills: ["shell", "fs-read"] },
      "/tmp/mcp.json",
    );
    const idx = args.indexOf("--allowedTools");
    expect(idx).toBeGreaterThan(-1);
    const value = args[idx + 1]!;
    const tools = value.split(",");
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
    expect(tools).toContain("mcp__dashboard__request_permission");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
  });

  it("auto-injects chat skill when missing from agent.skills", () => {
    const args = buildClaudeArgs(
      { ...baseAgent, skills: ["shell"] },
      "/tmp/mcp.json",
    );
    const idx = args.indexOf("--allowedTools");
    const tools = args[idx + 1]!.split(",");
    expect(tools).toContain("mcp__dashboard__request_permission");
  });

  it("falls back to chat-only when skills array is empty", () => {
    const args = buildClaudeArgs(
      { ...baseAgent, skills: [] },
      "/tmp/mcp.json",
    );
    const idx = args.indexOf("--allowedTools");
    const tools = args[idx + 1]!.split(",");
    expect(tools).toEqual(["mcp__dashboard__request_permission"]);
  });
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm -F @dashboard-agent/main test -- orchestrator.lifecycle
```
Expected: FAIL — `--allowedTools` not in args.

- [ ] **Step 3: Update `buildClaudeArgs`**

Open `apps/main/src/orchestrator/lifecycle.ts`. The current `buildClaudeArgs` function (post-PR-A) looks like:

```typescript
export const buildClaudeArgs = (agent: Agent, mcpConfigPath: string): string[] => {
  const args = [
    "--system-prompt",
    buildAgentSystemPrompt(agent.systemPrompt),
    "--model",
    agent.model,
    "--input-format",
    "stream-json",
    // ...
  ];
  // ...
};
```

Update to pass skills and add `--allowedTools`:

```typescript
export const buildClaudeArgs = (agent: Agent, mcpConfigPath: string): string[] => {
  const allowedTools = resolveSkillTools(agent.skills);
  const args = [
    "--system-prompt",
    buildAgentSystemPrompt(agent.systemPrompt, agent.skills),
    "--model",
    agent.model,
    "--allowedTools",
    allowedTools.join(","),
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

Add the import at the top of the file (alongside existing shared imports):

```typescript
import { resolveSkillTools } from "@dashboard-agent/shared";
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @dashboard-agent/main test -- orchestrator.lifecycle
```
Expected: PASS (3 new + all existing).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/orchestrator/lifecycle.ts apps/main/tests/orchestrator.lifecycle.test.ts
git commit -m "feat(m7b): buildClaudeArgs gates tools via --allowedTools"
```

---

## Task 8: Post-migration 0004 — seed roles + backfill CEO

**Files:**
- Create: `apps/main/src/db/post-migrations/0004.ts`
- Create: `apps/main/tests/db.post-migration-0004.test.ts`
- Modify: `apps/main/src/db/post-migrations/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/main/tests/db.post-migration-0004.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0004 } from "../src/db/post-migrations/0004.js";

const setupCompany = (db: Database.Database, companyId = "c1") => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, 'Acme', 0)").run(companyId);
};

const seedAgent = (
  db: Database.Database,
  id: string,
  companyId: string,
  opts: { templateId?: string | null; skillsJson?: string; reportsTo?: string | null } = {},
) => {
  db.prepare(
    `INSERT INTO agents (
      id, company_id, name, role, template_id, system_prompt, skills_json, allowed_projects_json,
      mode, always_on, reports_to, status, current_action, created_at, updated_at
    ) VALUES (?, ?, 'X', 'r', ?, 'sp', ?, '[]', 'supervised', 0, ?, 'idle', NULL, 0, 0)`,
  ).run(
    id,
    companyId,
    opts.templateId ?? null,
    opts.skillsJson ?? "[]",
    opts.reportsTo ?? null,
  );
};

describe("postMigration 0004 — seed roles + backfill", () => {
  it("seeds the 5 canonical roles when role_templates is empty", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    runPostMigration0004(db);
    const rows = db.prepare("SELECT id, name FROM role_templates ORDER BY id").all() as Array<{
      id: string;
      name: string;
    }>;
    expect(rows.map((r) => r.id).sort()).toEqual([
      "role-ceo",
      "role-designer",
      "role-engineer",
      "role-pm",
      "role-qa",
    ]);
  });

  it("seeded CEO role has Opus model and delegation+issues+inbox+chat+fs-read skills", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    runPostMigration0004(db);
    const ceo = db
      .prepare("SELECT default_model, default_skills_json FROM role_templates WHERE id = 'role-ceo'")
      .get() as { default_model: string; default_skills_json: string };
    expect(ceo.default_model).toBe("claude-opus-4-7");
    expect(JSON.parse(ceo.default_skills_json).sort()).toEqual([
      "chat",
      "delegation",
      "fs-read",
      "inbox",
      "issues",
    ]);
  });

  it("backfills root CEO agent (reports_to IS NULL, template_id IS NULL) with role-ceo data", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupCompany(db);
    seedAgent(db, "ceo_a", "c1", { reportsTo: null, templateId: null, skillsJson: "[]" });
    runPostMigration0004(db);
    const row = db
      .prepare("SELECT template_id, skills_json, model FROM agents WHERE id = 'ceo_a'")
      .get() as { template_id: string; skills_json: string; model: string };
    expect(row.template_id).toBe("role-ceo");
    expect(JSON.parse(row.skills_json).sort()).toEqual([
      "chat",
      "delegation",
      "fs-read",
      "inbox",
      "issues",
    ]);
    expect(row.model).toBe("claude-opus-4-7");
  });

  it("backfills non-root orphan agents (reports_to IS NOT NULL, template_id IS NULL) with role-engineer", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupCompany(db);
    seedAgent(db, "ceo_a", "c1", { reportsTo: null, templateId: null });
    seedAgent(db, "eng_a", "c1", { reportsTo: "ceo_a", templateId: null });
    runPostMigration0004(db);
    const row = db
      .prepare("SELECT template_id, skills_json, model FROM agents WHERE id = 'eng_a'")
      .get() as { template_id: string; skills_json: string; model: string };
    expect(row.template_id).toBe("role-engineer");
    expect(JSON.parse(row.skills_json).sort()).toEqual([
      "chat",
      "fs-read",
      "fs-write",
      "issues",
      "shell",
    ]);
    expect(row.model).toBe("claude-sonnet-4-6");
  });

  it("does not overwrite an agent that already has a template_id", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupCompany(db);
    seedAgent(db, "a1", "c1", {
      templateId: "role-engineer",
      skillsJson: JSON.stringify(["fs-read"]),
    });
    runPostMigration0004(db);
    const row = db
      .prepare("SELECT template_id, skills_json FROM agents WHERE id = 'a1'")
      .get() as { template_id: string; skills_json: string };
    expect(row.template_id).toBe("role-engineer");
    expect(JSON.parse(row.skills_json)).toEqual(["fs-read"]); // untouched
  });

  it("is idempotent — second run does not duplicate roles or change agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupCompany(db);
    seedAgent(db, "ceo_a", "c1", { reportsTo: null, templateId: null });

    runPostMigration0004(db);
    runPostMigration0004(db);

    const roleCount = (
      db.prepare("SELECT COUNT(*) AS n FROM role_templates").get() as { n: number }
    ).n;
    expect(roleCount).toBe(5);

    const row = db
      .prepare("SELECT template_id FROM agents WHERE id = 'ceo_a'")
      .get() as { template_id: string };
    expect(row.template_id).toBe("role-ceo");
  });

  it("sets the done flag in settings", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    runPostMigration0004(db);
    const flag = db
      .prepare("SELECT value FROM settings WHERE key = 'post_migration_0004_done'")
      .get() as { value: string } | undefined;
    expect(flag?.value).toBe("1");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm -F @dashboard-agent/main test -- db.post-migration-0004
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement 0004.ts**

Create `apps/main/src/db/post-migrations/0004.ts`:

```typescript
import type Database from "better-sqlite3";

// Seeds the 5 canonical role_templates and backfills agents missing a
// template_id. Idempotent via the post_migration_0004_done settings flag.
//
// Backfill strategy:
//   * Agents with reports_to IS NULL are treated as the company CEO and get
//     role-ceo (with Opus + delegation/issues/inbox/chat/fs-read skills).
//   * Other orphan agents (with template_id NULL but reports_to set) are
//     defensively backfilled with role-engineer. This shouldn't occur in
//     practice — M3 only seeded a single CEO — but covers any leftover state.
//   * Agents with a template_id already set are left alone.

const FLAG_KEY = "post_migration_0004_done";

type RoleSeed = {
  id: string;
  name: string;
  description: string;
  default_system_prompt: string;
  default_skills_json: string;
  default_model: string;
  icon: string | null;
};

const ROLES: RoleSeed[] = [
  {
    id: "role-ceo",
    name: "CEO",
    description: "Receives requests from the user, delegates work to specialists.",
    default_system_prompt:
      "You are the CEO. Receive user requests via chat, decide whether to handle directly or delegate to a specialist agent, and orchestrate the team. Never execute technical work yourself.",
    default_skills_json: JSON.stringify(["delegation", "issues", "inbox", "chat", "fs-read"]),
    default_model: "claude-opus-4-7",
    icon: "📋",
  },
  {
    id: "role-engineer",
    name: "Engineer",
    description: "Writes code, runs tests, fixes bugs, closes issues.",
    default_system_prompt:
      "You are an engineer. Write clean code, run tests before declaring done, and reference issue IDs in your commits. Use absolute paths inside allowed project directories.",
    default_skills_json: JSON.stringify(["shell", "fs-read", "fs-write", "issues", "chat"]),
    default_model: "claude-sonnet-4-6",
    icon: "👨‍💻",
  },
  {
    id: "role-qa",
    name: "QA",
    description: "Tests features end-to-end and files bug reports.",
    default_system_prompt:
      "You are QA. Run the test suite, exercise the feature manually if needed, and file detailed bug issues. Do not modify code yourself — your fs-read access is for inspection.",
    default_skills_json: JSON.stringify(["shell", "fs-read", "issues", "chat"]),
    default_model: "claude-sonnet-4-6",
    icon: "🧪",
  },
  {
    id: "role-designer",
    name: "Designer",
    description: "Proposes mockups, copy, UX feedback.",
    default_system_prompt:
      "You are a designer. Read existing UI code for context, search the web for inspiration, and propose specific changes via issue comments. Do not write code directly.",
    default_skills_json: JSON.stringify(["fs-read", "web", "issues", "chat"]),
    default_model: "claude-haiku-4-5-20251001",
    icon: "🎨",
  },
  {
    id: "role-pm",
    name: "PM",
    description: "Coordinates the team, prioritizes the issue queue.",
    default_system_prompt:
      "You are a product manager. Triage the issue backlog, prioritize work, delegate to engineers, and keep the user informed via reports. You do not write code.",
    default_skills_json: JSON.stringify(["delegation", "issues", "web", "chat"]),
    default_model: "claude-sonnet-4-6",
    icon: "📊",
  },
];

export const runPostMigration0004 = (db: Database.Database): void => {
  const done = db.prepare("SELECT value FROM settings WHERE key = ?").get(FLAG_KEY) as
    | { value: string }
    | undefined;
  if (done !== undefined) return;

  const upsertRole = db.prepare(
    `INSERT INTO role_templates (id, name, description, default_system_prompt, default_skills_json, icon, default_model)
     VALUES (@id, @name, @description, @default_system_prompt, @default_skills_json, @icon, @default_model)
     ON CONFLICT(id) DO NOTHING`,
  );
  const setAgentRole = db.prepare(
    `UPDATE agents
     SET template_id = ?, skills_json = ?, model = ?
     WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    // Seed roles.
    for (const r of ROLES) {
      upsertRole.run(r);
    }

    // Backfill agents missing a template_id.
    const orphans = db
      .prepare("SELECT id, reports_to FROM agents WHERE template_id IS NULL")
      .all() as Array<{ id: string; reports_to: string | null }>;

    const ceoRole = ROLES.find((r) => r.id === "role-ceo")!;
    const engRole = ROLES.find((r) => r.id === "role-engineer")!;

    for (const a of orphans) {
      const role = a.reports_to === null ? ceoRole : engRole;
      setAgentRole.run(role.id, role.default_skills_json, role.default_model, a.id);
    }

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FLAG_KEY, "1");
  });
  tx();
};
```

- [ ] **Step 4: Register in post-migrations/index.ts**

Read `apps/main/src/db/post-migrations/index.ts` to confirm the existing array shape. Add the new import and entry:

```typescript
import type Database from "better-sqlite3";
import { runPostMigration0002 } from "./0002.js";
import { runPostMigration0003 } from "./0003.js";
import { runPostMigration0004 } from "./0004.js";

const SCRIPTS: Array<{ id: number; run: (db: Database.Database) => void }> = [
  { id: 2, run: runPostMigration0002 },
  { id: 3, run: runPostMigration0003 },
  { id: 4, run: runPostMigration0004 },
];

export const runPostMigrations = (db: Database.Database): void => {
  for (const s of SCRIPTS) s.run(db);
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm -F @dashboard-agent/main test -- db.post-migration-0004
```
Expected: PASS (all 7 tests).

- [ ] **Step 6: Run full migration suite**

```bash
pnpm -F @dashboard-agent/main test -- db
```
Expected: PASS for all `db.*` tests.

- [ ] **Step 7: Commit**

```bash
git add apps/main/src/db/post-migrations/0004.ts apps/main/src/db/post-migrations/index.ts apps/main/tests/db.post-migration-0004.test.ts
git commit -m "feat(m7b): post-migration 0004 — seed 5 roles + backfill CEO/orphans"
```

---

## Task 9: `hire_agent` accepts `role_template_id`

**Files:**
- Modify: `apps/main/src/mcp/tools.ts`
- Modify: `apps/main/tests/mcp.tools.test.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/main/tests/mcp.tools.test.ts`. Append a new test inside the existing `describe("mcp tools (M3 mocks)", ...)` block (right before its closing `});`):

```typescript
  it("hire_agent applies skills + model from role_template_id when provided", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a','c','Caller','C','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();
    // Run post-migration to seed the roles.
    const { runPostMigration0004 } = await import("../src/db/post-migrations/0004.js");
    runPostMigration0004(ctx.db);

    const def = toolDefinitions.find((t) => t.name === "hire_agent");
    expect(def).toBeDefined();
    const result = await def!.run(
      {
        name: "Sam",
        role: "Engineer",
        system_prompt: "you are an engineer, write good code",
        role_template_id: "role-engineer",
      },
      ctx,
    );
    const parsed = JSON.parse(result) as { id: string };
    const created = createAgentsRepository(ctx.db).getById(parsed.id);
    expect(created?.templateId).toBe("role-engineer");
    expect(created?.skills.sort()).toEqual([
      "chat",
      "fs-read",
      "fs-write",
      "issues",
      "shell",
    ]);
    expect(created?.model).toBe("claude-sonnet-4-6");
  });

  it("hire_agent without role_template_id falls back to settings default (no skills)", async () => {
    const ctx = makeCtx();
    ctx.db.prepare(`INSERT INTO companies(id,name,created_at) VALUES('c','Acme',1)`).run();
    ctx.db
      .prepare(
        `INSERT INTO agents(id,company_id,name,role,system_prompt,skills_json,allowed_projects_json,mode,always_on,status,created_at,updated_at) VALUES('a','c','Caller','C','sp','[]','[]','supervised',0,'idle',1,1)`,
      )
      .run();
    const { runPostMigration0004 } = await import("../src/db/post-migrations/0004.js");
    runPostMigration0004(ctx.db);

    const def = toolDefinitions.find((t) => t.name === "hire_agent");
    const result = await def!.run(
      {
        name: "Plain",
        role: "Generic",
        system_prompt: "you are a generic worker without a role",
      },
      ctx,
    );
    const parsed = JSON.parse(result) as { id: string };
    const created = createAgentsRepository(ctx.db).getById(parsed.id);
    expect(created?.templateId).toBeNull();
    expect(created?.skills).toEqual([]);
    // Model still falls back to settings.defaultModelForNewAgents (PR-A).
    expect(created?.model).toBe("claude-sonnet-4-6");
  });
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm -F @dashboard-agent/main test -- mcp.tools
```
Expected: FAIL — current `hire_agent` doesn't apply role.

- [ ] **Step 3: Update hire_agent**

Open `apps/main/src/mcp/tools.ts`. Find the `hire_agent` tool entry. Add `role_template_id` to its `inputSchema` and `run` typing. The new shape:

```typescript
  {
    name: "hire_agent",
    description:
      "Hire a new agent. Optionally pass role_template_id (e.g. 'role-engineer') to seed skills + model from a role.",
    inputSchema: z.object({
      name: z.string().min(1),
      role: z.string().min(1),
      system_prompt: z.string().min(20),
      mode: z.enum(["supervised", "auto"]).optional(),
      reports_to: z.string().optional(),
      role_template_id: z.string().optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: {
        name: string;
        role: string;
        system_prompt: string;
        mode?: "supervised" | "auto";
        reports_to?: string;
        role_template_id?: string;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const agents = createAgentsRepository(ctx.db);
      const messages = createMessagesRepository(ctx.db);
      const settings = createSettingsRepository(ctx.db).read();

      // Resolve role template if provided. Skip silently if id is unknown
      // (defensive — agent gets empty skills + settings default model).
      let roleSkills: string[] = [];
      let roleModel: string | null = null;
      let templateId: string | null = null;
      if (input.role_template_id !== undefined) {
        const row = ctx.db
          .prepare(
            "SELECT default_skills_json, default_model FROM role_templates WHERE id = ?",
          )
          .get(input.role_template_id) as
          | { default_skills_json: string; default_model: string }
          | undefined;
        if (row !== undefined) {
          roleSkills = JSON.parse(row.default_skills_json) as string[];
          roleModel = row.default_model;
          templateId = input.role_template_id;
        }
      }

      const agent = agents.create({
        companyId: ctx.companyId,
        name: input.name,
        role: input.role,
        systemPrompt: input.system_prompt,
        mode: input.mode ?? "supervised",
        alwaysOn: false,
        model: roleModel ?? settings.defaultModelForNewAgents,
        skills: roleSkills,
        templateId,
      });
      const reportsTo = input.reports_to ?? ctx.agentId;
      ctx.db.prepare("UPDATE agents SET reports_to = ? WHERE id = ?").run(reportsTo, agent.id);
      messages.ensureThread(ctx.companyId, [ctx.agentId, agent.id]);
      ctx.emit({ kind: "agent.spawn-needed", payload: { agentId: agent.id } });
      return JSON.stringify({ id: agent.id, name: agent.name, role: agent.role });
    },
  },
```

(Imports needed at top of file — verify they already include `createSettingsRepository` from PR-A. If not, add it.)

- [ ] **Step 4: Run tests**

```bash
pnpm -F @dashboard-agent/main test -- mcp.tools
```
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/mcp/tools.ts apps/main/tests/mcp.tools.test.ts
git commit -m "feat(m7b): hire_agent applies role_template_id (skills + model)"
```

---

## Task 10: Role templates repository

**Files:**
- Create: `apps/main/src/agents/role-templates-repository.ts`
- Create: `apps/main/tests/role-templates.repository.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/main/tests/role-templates.repository.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0004 } from "../src/db/post-migrations/0004.js";
import { createRoleTemplatesRepository } from "../src/agents/role-templates-repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
  runPostMigration0004(db);
  return { db, repo: createRoleTemplatesRepository(db) };
};

describe("RoleTemplatesRepository", () => {
  it("listAll returns the 5 seeded roles", () => {
    const { repo } = setup();
    const roles = repo.listAll();
    expect(roles.map((r) => r.id).sort()).toEqual([
      "role-ceo",
      "role-designer",
      "role-engineer",
      "role-pm",
      "role-qa",
    ]);
  });

  it("each role has parsed skills + default_model + icon", () => {
    const { repo } = setup();
    const eng = repo.listAll().find((r) => r.id === "role-engineer")!;
    expect(eng.defaultSkills).toContain("shell");
    expect(eng.defaultModel).toBe("claude-sonnet-4-6");
    expect(eng.icon).toBe("👨‍💻");
  });

  it("getById returns null for unknown id", () => {
    const { repo } = setup();
    expect(repo.getById("role-doesnt-exist")).toBeNull();
  });

  it("agentsUsing returns agents matching template_id", () => {
    const { db, repo } = setup();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, template_id, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1', 'c1', 'Alice', 'Engineer', 'role-engineer', 'sp', '[]', '[]', 'supervised', 0, 'idle', 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, template_id, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a2', 'c1', 'Bob', 'Engineer', 'role-engineer', 'sp', '[]', '[]', 'supervised', 0, 'idle', 0, 0)`,
    ).run();
    const list = repo.agentsUsing("role-engineer");
    expect(list.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
    expect(list.map((a) => a.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("agentsUsing returns empty when no agents use the role", () => {
    const { repo } = setup();
    expect(repo.agentsUsing("role-designer")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm -F @dashboard-agent/main test -- role-templates.repository
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the repository**

Create `apps/main/src/agents/role-templates-repository.ts`:

```typescript
import type Database from "better-sqlite3";
import type { RoleTemplate } from "@dashboard-agent/shared";

type Row = {
  id: string;
  name: string;
  description: string;
  default_system_prompt: string;
  default_skills_json: string;
  default_model: string;
  icon: string | null;
};

const rowToRole = (r: Row): RoleTemplate => ({
  id: r.id,
  name: r.name,
  description: r.description,
  defaultSystemPrompt: r.default_system_prompt,
  defaultSkills: JSON.parse(r.default_skills_json) as string[],
  defaultModel: r.default_model,
  icon: r.icon,
});

export type RoleTemplatesRepository = {
  listAll(): RoleTemplate[];
  getById(id: string): RoleTemplate | null;
  agentsUsing(id: string): Array<{ id: string; name: string }>;
};

export const createRoleTemplatesRepository = (
  db: Database.Database,
): RoleTemplatesRepository => {
  const listStmt = db.prepare(
    "SELECT id, name, description, default_system_prompt, default_skills_json, default_model, icon FROM role_templates ORDER BY id",
  );
  const byIdStmt = db.prepare(
    "SELECT id, name, description, default_system_prompt, default_skills_json, default_model, icon FROM role_templates WHERE id = ?",
  );
  const agentsStmt = db.prepare(
    "SELECT id, name FROM agents WHERE template_id = ? ORDER BY created_at",
  );

  return {
    listAll() {
      return (listStmt.all() as Row[]).map(rowToRole);
    },
    getById(id) {
      const row = byIdStmt.get(id) as Row | undefined;
      return row ? rowToRole(row) : null;
    },
    agentsUsing(id) {
      return agentsStmt.all(id) as Array<{ id: string; name: string }>;
    },
  };
};
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @dashboard-agent/main test -- role-templates.repository
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/main/src/agents/role-templates-repository.ts apps/main/tests/role-templates.repository.test.ts
git commit -m "feat(m7b): role templates repository (listAll, getById, agentsUsing)"
```

---

## Task 11: IPC channels + handlers + preload for roles

**Files:**
- Modify: `packages/shared/src/ipc-channels.ts`
- Create: `apps/main/src/ipc/roles-handlers.ts`
- Modify: `apps/main/src/ipc/handlers.ts`
- Modify: `apps/main/src/ipc/preload.ts`
- Create: `apps/main/tests/ipc.roles-handlers.test.ts`

- [ ] **Step 1: Add channel constants**

Read `packages/shared/src/ipc-channels.ts` first. Add two new entries to the `IPC` object — group them logically with existing similar entries (e.g. after `PROJECTS_*`):

```typescript
  ROLES_LIST: "roles:list",
  ROLES_GET: "roles:get",
```

- [ ] **Step 2: Write the handler test**

Create `apps/main/tests/ipc.roles-handlers.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0004 } from "../src/db/post-migrations/0004.js";

// Mock electron's ipcMain so we can capture and invoke the registered handlers.
type Handler = (e: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, h: Handler) => {
      handlers.set(channel, h);
    },
  },
}));

import { registerRolesHandlers } from "../src/ipc/roles-handlers.js";

beforeEach(() => {
  handlers.clear();
});

const invoke = async (channel: string, ...args: unknown[]) => {
  const h = handlers.get(channel);
  if (h === undefined) throw new Error(`no handler for ${channel}`);
  return await h(null, ...args);
};

describe("roles IPC handlers", () => {
  it("roles:list returns the 5 seeded roles with agent counts", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'A', 0)").run();
    runPostMigration0004(db);
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, template_id, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1', 'c1', 'X', 'r', 'role-engineer', 'sp', '[]', '[]', 'supervised', 0, 'idle', 0, 0)`,
    ).run();

    registerRolesHandlers(db);
    const list = (await invoke("roles:list")) as Array<{ id: string; agentCount: number }>;
    expect(list).toHaveLength(5);
    const eng = list.find((r) => r.id === "role-engineer")!;
    expect(eng.agentCount).toBe(1);
    const ceo = list.find((r) => r.id === "role-ceo")!;
    expect(ceo.agentCount).toBe(0);
  });

  it("roles:get returns RoleDetail with resolvedTools and agentsUsing", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'A', 0)").run();
    runPostMigration0004(db);
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, template_id, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1', 'c1', 'Alice', 'r', 'role-engineer', 'sp', '[]', '[]', 'supervised', 0, 'idle', 0, 0)`,
    ).run();
    registerRolesHandlers(db);

    const detail = (await invoke("roles:get", null, { id: "role-engineer" })) as {
      id: string;
      defaultSkills: string[];
      resolvedTools: string[];
      agentsUsing: Array<{ id: string; name: string }>;
    } | null;

    expect(detail).not.toBeNull();
    expect(detail!.defaultSkills).toContain("shell");
    expect(detail!.resolvedTools).toContain("Bash");
    expect(detail!.resolvedTools).toContain("mcp__dashboard__request_permission");
    expect(detail!.agentsUsing).toEqual([{ id: "a1", name: "Alice" }]);
  });

  it("roles:get returns null for unknown id", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'A', 0)").run();
    runPostMigration0004(db);
    registerRolesHandlers(db);

    const result = await invoke("roles:get", null, { id: "role-does-not-exist" });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify failure**

```bash
pnpm -F @dashboard-agent/main test -- ipc.roles-handlers
```
Expected: FAIL — handler module doesn't exist.

- [ ] **Step 4: Implement the handlers**

Create `apps/main/src/ipc/roles-handlers.ts`:

```typescript
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, resolveSkillTools, type RoleDetail, type RoleTemplate } from "@dashboard-agent/shared";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";

type RoleSummary = RoleTemplate & { agentCount: number };

export const registerRolesHandlers = (db: Database.Database): void => {
  const repo = createRoleTemplatesRepository(db);

  ipcMain.handle(IPC.ROLES_LIST, (): RoleSummary[] => {
    const roles = repo.listAll();
    return roles.map((r) => ({
      ...r,
      agentCount: repo.agentsUsing(r.id).length,
    }));
  });

  ipcMain.handle(
    IPC.ROLES_GET,
    (_event, payload: { id: string }): RoleDetail | null => {
      const role = repo.getById(payload.id);
      if (role === null) return null;
      return {
        ...role,
        resolvedTools: resolveSkillTools(role.defaultSkills),
        agentsUsing: repo.agentsUsing(role.id),
      };
    },
  );
};
```

- [ ] **Step 5: Register in handlers.ts**

Open `apps/main/src/ipc/handlers.ts`. Add an import and a registration call. The result should look like:

```typescript
import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@dashboard-agent/shared";
import { registerSettingsHandlers } from "./settings-handlers.js";
import { registerAuthHandlers } from "./auth-handlers.js";
import { registerCompaniesHandlers } from "./companies-handlers.js";
import { registerMessagesHandlers } from "./messages-handlers.js";
import { registerOrchestratorHandlers } from "./orchestrator-handlers.js";
import { registerPermissionHandlers } from "./permission-handlers.js";
import { registerInboxHandlers } from "./inbox-handlers.js";
import { registerProjectsHandlers } from "./projects-handlers.js";
import { registerIssuesHandlers } from "./issues-handlers.js";
import { registerRolesHandlers } from "./roles-handlers.js";

export const registerIpcHandlers = (db: Database.Database): void => {
  ipcMain.handle(IPC.PING, () => "pong");
  registerSettingsHandlers(db);
  registerAuthHandlers(db);
  registerCompaniesHandlers(db);
  registerMessagesHandlers(db);
  registerOrchestratorHandlers(db);
  registerPermissionHandlers(db);
  registerInboxHandlers(db);
  registerProjectsHandlers(db);
  registerIssuesHandlers(db);
  registerRolesHandlers(db);
};
```

- [ ] **Step 6: Expose in preload.ts**

Open `apps/main/src/ipc/preload.ts`. Add the `RoleTemplate` and `RoleDetail` types to the import block at the top:

```typescript
  type RoleTemplate,
  type RoleDetail,
```

(They go alphabetically inside the existing import statement.)

Then add a `roles` namespace to the `contextBridge.exposeInMainWorld` object. Place it just before the closing brace:

```typescript
  roles: {
    list: () =>
      ipcRenderer.invoke(IPC.ROLES_LIST) as Promise<Array<RoleTemplate & { agentCount: number }>>,
    get: (id: string) =>
      ipcRenderer.invoke(IPC.ROLES_GET, { id }) as Promise<RoleDetail | null>,
  },
```

- [ ] **Step 7: Run tests**

```bash
pnpm -F @dashboard-agent/main test -- ipc.roles-handlers
```
Expected: PASS (3 tests).

```bash
pnpm test
```
Expected: full suite still PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/ipc-channels.ts apps/main/src/ipc/roles-handlers.ts apps/main/src/ipc/handlers.ts apps/main/src/ipc/preload.ts apps/main/tests/ipc.roles-handlers.test.ts
git commit -m "feat(m7b): IPC channels for roles list/get"
```

---

## Task 12: i18n strings for /skills page

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`

- [ ] **Step 1: Add skills.* keys + nav entry to en-US.json**

Read `apps/renderer/src/i18n/en-US.json` first. Add a new top-level `"skills"` block (between `"issues"` and the closing brace), and a `"skills"` entry inside the existing `"nav"` block.

In `"nav"` (after `"issues"`):
```json
    "skills": "Skills",
```

New top-level block (the project uses flat dot-notation inside top-level objects, mirroring the `"settings"` pattern):
```json
  "skills": {
    "title": "Skills (Roles)",
    "subtitle": "Roles available for hiring. Each role bundles a set of skills and a default Claude model.",
    "empty": "No roles available.",
    "agentsCount_zero": "{{count}} agents",
    "agentsCount_one": "{{count}} agent",
    "agentsCount_other": "{{count}} agents",
    "detail.tools": "Tools",
    "detail.defaultModel": "Default model",
    "detail.agentsUsing": "Agents using this role",
    "detail.noAgents": "No agents currently use this role.",
    "detail.skillsGroup": "Skill: {{skill}}"
  },
```

- [ ] **Step 2: Add the same keys translated in pt-BR.json**

Mirror in `apps/renderer/src/i18n/pt-BR.json`:

In `"nav"`:
```json
    "skills": "Habilidades",
```

Top-level:
```json
  "skills": {
    "title": "Habilidades (Cargos)",
    "subtitle": "Cargos disponíveis para contratação. Cada cargo agrupa um conjunto de habilidades e um modelo Claude padrão.",
    "empty": "Nenhum cargo disponível.",
    "agentsCount_zero": "{{count}} agentes",
    "agentsCount_one": "{{count}} agente",
    "agentsCount_other": "{{count}} agentes",
    "detail.tools": "Ferramentas",
    "detail.defaultModel": "Modelo padrão",
    "detail.agentsUsing": "Agentes usando este cargo",
    "detail.noAgents": "Nenhum agente usa este cargo no momento.",
    "detail.skillsGroup": "Habilidade: {{skill}}"
  },
```

- [ ] **Step 3: Verify both files parse as JSON**

```bash
node -e "require('./apps/renderer/src/i18n/en-US.json'); require('./apps/renderer/src/i18n/pt-BR.json'); console.log('OK')"
```
Expected: `OK`.

- [ ] **Step 4: Verify parity**

```bash
node -e "const flat=(o,p='')=>Object.keys(o).reduce((a,k)=>(typeof o[k]==='object'?{...a,...flat(o[k],p+k+'.')}:Object.assign(a,{[p+k]:1})),{}); const e=flat(require('./apps/renderer/src/i18n/en-US.json')); const p=flat(require('./apps/renderer/src/i18n/pt-BR.json')); console.log('only en:', Object.keys(e).filter(k=>!p[k])); console.log('only pt:', Object.keys(p).filter(k=>!e[k]));"
```
Expected: both arrays empty.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/i18n/en-US.json apps/renderer/src/i18n/pt-BR.json
git commit -m "feat(m7b): i18n strings for /skills page"
```

---

## Task 13: Roles zustand store

**Files:**
- Create: `apps/renderer/src/stores/roles.ts`

- [ ] **Step 1: Implement the store**

Create `apps/renderer/src/stores/roles.ts`:

```typescript
import { create } from "zustand";
import type { RoleDetail, RoleTemplate } from "@dashboard-agent/shared";

type RoleSummary = RoleTemplate & { agentCount: number };

type State = {
  roles: RoleSummary[];
  selectedId: string | null;
  selectedDetail: RoleDetail | null;
  loaded: boolean;
  load: () => Promise<void>;
  select: (id: string) => Promise<void>;
};

export const useRolesStore = create<State>((set, get) => ({
  roles: [],
  selectedId: null,
  selectedDetail: null,
  loaded: false,

  load: async () => {
    const list = await window.dashboardAgent.roles.list();
    set({ roles: list, loaded: true });
    // Auto-select the first role if none is selected yet.
    if (get().selectedId === null && list.length > 0) {
      await get().select(list[0]!.id);
    }
  },

  select: async (id) => {
    set({ selectedId: id });
    const detail = await window.dashboardAgent.roles.get(id);
    set({ selectedDetail: detail });
  },
}));
```

- [ ] **Step 2: Verify renderer build**

```bash
pnpm -F @dashboard-agent/renderer build
```
Expected: PASS (the store isn't used yet — that's fine; next task wires it).

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/stores/roles.ts
git commit -m "feat(m7b): roles zustand store"
```

---

## Task 14: `/skills` master-detail UI

**Files:**
- Create: `apps/renderer/src/components/skills/RoleListItem.tsx`
- Create: `apps/renderer/src/components/skills/RoleDetail.tsx`
- Create: `apps/renderer/src/routes/Skills.tsx`

- [ ] **Step 1: Create RoleListItem component**

Create `apps/renderer/src/components/skills/RoleListItem.tsx`:

```typescript
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { RoleTemplate } from "@dashboard-agent/shared";

type Props = {
  role: RoleTemplate & { agentCount: number };
  selected: boolean;
  onSelect: () => void;
};

export const RoleListItem: FC<Props> = ({ role, selected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded border-l-2 transition-colors ${
        selected
          ? "bg-brand-bg border-brand text-brand-dark"
          : "border-transparent hover:bg-surface-soft text-ink"
      }`}
    >
      <div className="flex items-center gap-2">
        {role.icon !== null && <span className="text-base">{role.icon}</span>}
        <span className="font-semibold text-sm">{role.name}</span>
      </div>
      <div className="text-[11px] text-ink-muted mt-0.5">
        {t("skills.agentsCount", { count: role.agentCount })}
      </div>
    </button>
  );
};
```

- [ ] **Step 2: Create RoleDetail component**

Create `apps/renderer/src/components/skills/RoleDetail.tsx`:

```typescript
import { type FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SKILL_CATALOG, type RoleDetail as RoleDetailType } from "@dashboard-agent/shared";

type Props = {
  detail: RoleDetailType;
};

export const RoleDetail: FC<Props> = ({ detail }) => {
  const { t } = useTranslation();

  // Group resolvedTools back by skill so the UI shows "shell → Bash" etc.
  // The skills array on detail.defaultSkills tells us which skills are active;
  // chat is auto-added by the resolver, so include it explicitly when present
  // in resolvedTools.
  const grouped = useMemo(() => {
    const effective = [...detail.defaultSkills];
    if (!effective.includes("chat")) effective.push("chat");
    return effective
      .map((id) => SKILL_CATALOG[id as keyof typeof SKILL_CATALOG])
      .filter((s) => s !== undefined);
  }, [detail.defaultSkills]);

  return (
    <div className="p-6 max-w-3xl">
      <header className="flex items-center gap-3 mb-4">
        {detail.icon !== null && <span className="text-3xl">{detail.icon}</span>}
        <div>
          <h2 className="text-xl font-bold text-brand-dark">{detail.name}</h2>
          <p className="text-sm text-ink-muted mt-1">{detail.description}</p>
        </div>
      </header>

      <section className="mb-6">
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("skills.detail.defaultModel")}
        </h3>
        <code className="text-sm font-mono bg-surface-soft px-2 py-1 rounded inline-block">
          {detail.defaultModel}
        </code>
      </section>

      <section className="mb-6">
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("skills.detail.tools")}
        </h3>
        <div className="space-y-3">
          {grouped.map((skill) => (
            <div key={skill.id}>
              <div className="text-xs text-ink-muted mb-1.5">
                {t("skills.detail.skillsGroup", { skill: skill.id })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {skill.tools.map((tool) => (
                  <span
                    key={tool}
                    className="text-[11px] font-mono bg-brand-bg text-brand-dark px-2 py-0.5 rounded"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("skills.detail.agentsUsing")}
        </h3>
        {detail.agentsUsing.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("skills.detail.noAgents")}</p>
        ) : (
          <ul className="space-y-1">
            {detail.agentsUsing.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/agents/${a.id}`}
                  className="text-sm text-brand hover:underline"
                >
                  {a.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
```

- [ ] **Step 3: Create the Skills page**

Create `apps/renderer/src/routes/Skills.tsx`:

```typescript
import { useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useRolesStore } from "../stores/roles.js";
import { RoleListItem } from "../components/skills/RoleListItem.js";
import { RoleDetail } from "../components/skills/RoleDetail.js";

export const Skills: FC = () => {
  const { t } = useTranslation();
  const roles = useRolesStore((s) => s.roles);
  const selectedId = useRolesStore((s) => s.selectedId);
  const selectedDetail = useRolesStore((s) => s.selectedDetail);
  const loaded = useRolesStore((s) => s.loaded);
  const load = useRolesStore((s) => s.load);
  const select = useRolesStore((s) => s.select);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full">
      <aside className="w-60 border-r border-surface-border bg-surface-card flex flex-col">
        <header className="px-4 py-3 border-b border-surface-border">
          <h1 className="text-sm font-bold text-brand-dark">{t("skills.title")}</h1>
          <p className="text-[11px] text-ink-muted mt-1">{t("skills.subtitle")}</p>
        </header>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {!loaded ? (
            <p className="text-xs text-ink-muted p-2">…</p>
          ) : roles.length === 0 ? (
            <p className="text-xs text-ink-muted p-2">{t("skills.empty")}</p>
          ) : (
            roles.map((r) => (
              <RoleListItem
                key={r.id}
                role={r}
                selected={r.id === selectedId}
                onSelect={() => void select(r.id)}
              />
            ))
          )}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {selectedDetail !== null && <RoleDetail detail={selectedDetail} />}
      </main>
    </div>
  );
};
```

- [ ] **Step 4: Verify renderer build**

```bash
pnpm -F @dashboard-agent/renderer build
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/components/skills/RoleListItem.tsx apps/renderer/src/components/skills/RoleDetail.tsx apps/renderer/src/routes/Skills.tsx
git commit -m "feat(m7b): /skills master-detail page (RoleListItem + RoleDetail)"
```

---

## Task 15: Register `/skills` route + sidebar link

**Files:**
- Modify: `apps/renderer/src/App.tsx`

- [ ] **Step 1: Update App.tsx**

Open `apps/renderer/src/App.tsx`. Two changes:

1. **Add the import** alongside other route imports:

```typescript
import { Skills } from "./routes/Skills.js";
```

2. **Add a sidebar `NavLink`** for Skills. In the existing `nav` block, between the Issues NavLink and the Settings NavLink, insert:

```tsx
        <NavLink
          to="/skills"
          className={({ isActive }) =>
            `px-2 py-1 rounded ${isActive ? "bg-brand-bg text-brand" : "hover:bg-surface-soft"}`
          }
        >
          {t("nav.skills")}
        </NavLink>
```

3. **Add the route**. In the `<Routes>` block, insert a new `<Route>` between the existing `/issues` and `/agents/:id` routes:

```tsx
        <Route
          path="/skills"
          element={
            hasToken ? (
              <Layout>
                <Skills />
              </Layout>
            ) : (
              <Navigate to="/setup" replace />
            )
          }
        />
```

- [ ] **Step 2: Verify build + typecheck**

```bash
pnpm -F @dashboard-agent/renderer build
```
Expected: PASS.

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

```bash
pnpm dev
```

Open the app. Verify:
- Sidebar shows a new "Skills" link between Issues and Settings.
- Clicking it lands on `/skills`.
- Left pane lists 5 roles (CEO, Designer, Engineer, PM, QA — alphabetical by id).
- First role (CEO) auto-selects; right pane shows its detail with: model = `claude-opus-4-7`, tool chips grouped by skill (delegation, issues, inbox, chat, fs-read).
- Clicking other roles updates the right pane.
- "Agents using" lists the actual CEO under the role-ceo detail.

- [ ] **Step 4: Commit**

```bash
git add apps/renderer/src/App.tsx
git commit -m "feat(m7b): /skills route + sidebar link"
```

---

## Task 16: Regression + roadmap update

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```
Expected: PASS. Total ~225+ tests (208 baseline + new skills.test + role-templates + post-migration-0004 + ipc.roles-handlers + hire_agent role + buildClaudeArgs allowedTools = ~22+ new).

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```
Expected: clean.

- [ ] **Step 4: Verify hard-gate regression**

Confirm that an agent without `shell` skill cannot spawn with `Bash` in `--allowedTools`:

```bash
pnpm -F @dashboard-agent/main test -- orchestrator.lifecycle
```
Expected: all `--allowedTools` tests PASS.

- [ ] **Step 5: Verify M5 sandbox tests still green**

```bash
pnpm -F @dashboard-agent/main test -- security
```
Expected: gate, gate-projects, permission-watcher, blocklist all PASS.

- [ ] **Step 6: Update ROADMAP.md**

Open `ROADMAP.md`. Update the `Última atualização` line:

```markdown
> **Última atualização:** 2026-05-11 (M7-A PR-A mergeado — `0caa31b`; **M7-B PR-B mergeado** — `<final-sha>`; PR-C em curso; M7.5 + M10 adicionados após comparação com Paperclip e decisão de hybrid VPS)
```

In the "Status atual" table, bump test count:

```markdown
| Testes | 230+ passing, 41+ test files, 0 lint/typecheck errors |
```

(Actual numbers depend on how many tests landed — read the test output and use the real count.)

In the M7 section, mark the Skills and (where applicable) hire_agent items as done:

```markdown
- [x] **Skills:** — PR-B mergeado em `<sha>` (2026-05-11)
  - [x] Rota `/skills` master-detail read-only (lista 5 roles seedados + drill-down com tools chips agrupados por skill)
  - [ ] Em `/agents/:id` right panel: campo "Skills" — **defer pra PR-C**
  - [x] Aplicação real: agente só pode chamar tools listadas em skills — via `--allowedTools` no spawn (hard-gate)
  - [x] Templates de role (`role_templates` tabela) seedados pelo post-migration 0004 + usados como starting skills no hire_agent via `role_template_id`
```

And in the "Seleção de modelo" sub-section, mark the `hire_agent` line as done:

```markdown
  - [x] MCP tool `hire_agent`: aceita `role_template_id` que resolve skills + model do role (PR-B)
```

- [ ] **Step 7: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): m7-b pr-b merged — roles + skills hard-gate"
```

---

## Acceptance criteria

- [ ] Migration 0003 (PR-A) + post-migration 0004 (PR-B) apply clean on fresh DB.
- [ ] `role_templates` has 5 rows after post-migration 0004 (idempotent).
- [ ] CEO agent (`reports_to IS NULL`) is backfilled with `template_id='role-ceo'`, opus model, and skills `[delegation, issues, inbox, chat, fs-read]`.
- [ ] `buildClaudeArgs` output for an agent with `skills=['fs-read']` includes `--allowedTools Read,Glob,Grep,mcp__dashboard__request_permission` and does NOT include `Bash`, `Edit`, `Write`.
- [ ] `--allowedTools` is always present in spawn args even for an agent with empty skills (degrades to chat-only).
- [ ] `hire_agent` with `role_template_id="role-engineer"` creates an agent with the engineer skills + Sonnet model.
- [ ] `/skills` page renders 5 roles, click-through shows correct tool chips + model + agents using.
- [ ] Sidebar has "Skills" link between Issues and Settings.
- [ ] `pnpm test` passes (target: ~225+ tests).
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint` clean.
- [ ] No regressions in M5 security tests (gate.test, gate-projects.test, permission-watcher.test).

---

## Out of scope reminder

These belong to PR-C:

- Right panel in `/agents/:id` showing the agent's role + skills.
- Change-role modal in the right panel.
- Restart of running agents when skills change.
- `/org` route with org chart visualization.
- Per-agent skill drag-drop (never — spec says role-based only in v1).

---

## Self-review notes (writing-plans)

**Spec coverage** — every PR-B requirement in spec §1, §2.2, §3, §4.1, §4.2, §5.2, §6, §7 is implemented:

- §2.2 post-migration backfill → Task 8
- §3.1 5 roles seeded → Task 8
- §3.2 skillsToTools mapping → Task 3
- §3.3 defense in depth (allowedTools as visibility filter) → Task 7
- §4.1 buildClaudeArgs with --allowedTools → Task 7
- §4.1 system prompt skills injection → Task 6
- §4.2 hire_agent with role_template_id → Task 9
- §5.2 /skills master-detail → Task 14, 15
- §6.1 unit tests for skillsToTools + ensureChatSkill → Task 3
- §6.2 unit tests for buildClaudeArgs + hire_agent → Tasks 7, 9
- §6.3 backfill integration test → Task 8
- §7 security: regex on model id (already in PR-A); skill ID validation = silent drop on unknown (Task 3 test)

**Placeholder scan** — no TBDs/TODOs; all code blocks are complete and self-contained.

**Type consistency** — `skills: string[]` everywhere (not `skill_ids` or `skillNames`); `templateId: string | null` (not `template_id` in TS — that's only in DB Row); `agentCount` (not `agentsCount`); `defaultSkills` / `defaultModel` (not `default_skills` / `default_model` in TS land).

**Cross-task references** — Task 3 (skills.ts) is imported by Tasks 6 (system-prompt), 7 (lifecycle), 11 (roles-handlers). Task 8 (post-migration) is required by Task 9 (hire_agent test), 10 (repo test), 11 (handler test). Task 10 (repo) is used by Task 11 (handlers). Tasks 13-15 (UI) depend on Task 11 (IPC).

**Risk assessment** — biggest risk is `hire_agent` test interfering with existing tests that share `makeCtx()` — mitigated by each test creating a fresh DB. Second risk: `KNOWN_CLAUDE_TOOLS` coverage test will fail if Claude CLI gets a new built-in tool — that's the intended forcing function for skill categorization.
