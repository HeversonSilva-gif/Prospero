# M11 PR-A — Rename skills → capabilities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the M7 "skill" concept (tool-capability bundles) to "capability" everywhere, freeing the name "skill" for the M11 procedural-knowledge concept introduced in later PRs.

**Architecture:** This is a **pure mechanical rename — zero behavior change.** There is no new feature to test-drive. The safety net is `pnpm typecheck` + the existing test suite (973 tests) staying green. The only genuinely new test is the migration test for `0017` (written TDD-style). Each task renames one coherent "rename unit" across *all* files it touches, so the whole repo compiles and tests pass at every commit.

**Tech Stack:** TypeScript, pnpm workspaces (`@prospero/shared`, `@prospero/main`, `@prospero/renderer`), better-sqlite3, Vitest, React, react-router-dom, react-i18next, Electron.

**Spec:** `docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md` §11 PR-A.

---

## Rename Map (canonical reference)

Every task applies a slice of this map. Nothing outside it changes.

### Symbols — `packages/shared/src/skills.ts` → `capabilities.ts`
| Old | New |
|---|---|
| file `skills.ts` | `capabilities.ts` |
| `SkillId` | `CapabilityId` |
| `SkillDef` | `CapabilityDef` |
| `SKILL_CATALOG` | `CAPABILITY_CATALOG` |
| `ensureChatSkill` | `ensureChatCapability` |
| `skillsToTools` | `capabilitiesToTools` |
| `resolveSkillTools` | `resolveCapabilityTools` |
| `KNOWN_CLAUDE_TOOLS` | *unchanged* |

### DB columns
| Old | New |
|---|---|
| `agents.skills_json` | `agents.capabilities_json` |
| `role_templates.default_skills_json` | `role_templates.default_capabilities_json` |

### Type properties
| Old | New |
|---|---|
| `Agent.skills` | `Agent.capabilities` |
| `RoleTemplate.defaultSkills` | `RoleTemplate.defaultCapabilities` |
| `RoleDetail` (inherits `defaultCapabilities`) | — |
| `AgentToHire.skills` (`goal.ts`) | `AgentToHire.capabilities` |
| `ComposeArgs.skills` (`system-prompt.ts`) | `ComposeArgs.capabilities` |

### Activity action
| Old | New |
|---|---|
| `agent.skills_changed` | `agent.capabilities_changed` |

### Renderer
| Old | New |
|---|---|
| route `/skills` | `/roles` |
| `routes/Skills.tsx` (component `Skills`) | `routes/Roles.tsx` (component `Roles`) |
| `components/skills/` | `components/roles/` |
| `components/agent-panel/skillCategorize.ts` | `capabilityCategorize.ts` |
| `categorizeSkills` | `categorizeCapabilities` |
| `SkillRow` / `CategorizedSkills` / `CategorizeInput` | `CapabilityRow` / `CategorizedCapabilities` / `CategorizeInput` (last unchanged) |
| input fields `agentSkills` / `roleDefaultSkills` / `allSkills` | `agentCapabilities` / `roleDefaultCapabilities` / `allCapabilities` |
| agents store `setSkills` | `setCapabilities` |
| ConfigTab vars `allSkillIds` / `categorizedSkills` | `allCapabilityIds` / `categorizedCapabilities` |

### i18n keys (both `en-US.json` and `pt-BR.json`)
| Old key | New key |
|---|---|
| `nav.skills` | `nav.roles` |
| `skills` (object: title/subtitle/detail.*/agentsCount/empty) | `roles` |
| `skills.detail.skillsGroup` (interp var `skill`) | `roles.detail.capabilityGroup` (interp var `capability`) |
| `agent.config.skills` | `agent.config.capabilities` |
| `agent.config.skillsEdit` | `agent.config.capabilitiesEdit` |
| `plan.agentFields.skills` | `plan.agentFields.capabilities` |
| `skills_changed` (activity label) | `capabilities_changed` |

> **Do NOT touch migrations `0001`–`0016`.** Old migration SQL is historical — it already ran on existing databases. Migration `0017` does the column rename; old files keep saying `skills_json`.

---

## Task 1: Capabilities module + all symbol importers

**Files:**
- Rename: `packages/shared/src/skills.ts` → `packages/shared/src/capabilities.ts`
- Modify: `packages/shared/src/index.ts`
- Rename: `packages/shared/tests/skills.test.ts` → `packages/shared/tests/capabilities.test.ts`
- Modify: `apps/main/src/ipc/roles-handlers.ts`
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`
- Modify: `apps/main/src/orchestrator/system-prompt.ts`
- Modify: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`
- Modify: `apps/renderer/src/components/skills/RoleDetail.tsx`

- [ ] **Step 1: Move the module file with git**

```bash
git mv packages/shared/src/skills.ts packages/shared/src/capabilities.ts
git mv packages/shared/tests/skills.test.ts packages/shared/tests/capabilities.test.ts
```

- [ ] **Step 2: Replace the full content of `packages/shared/src/capabilities.ts`**

```typescript
// Canonical capability IDs and their resolved Claude tool sets. Modifying this
// file changes what each agent CAN see (the --allowedTools whitelist at spawn
// time). New built-in tools added to Claude CLI must be categorized into a
// capability here — the test "every built-in tool in KNOWN_CLAUDE_TOOLS is
// mapped" enforces this.

// Master list of built-in Claude tools we know about. Kept manually — when
// Claude CLI adds a new tool, add it here AND map it into a capability below.
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

export type CapabilityId =
  | "chat"
  | "delegation"
  | "fs-read"
  | "fs-write"
  | "inbox"
  | "issues"
  | "shell"
  | "web";

export type CapabilityDef = {
  id: CapabilityId;
  description: string;
  tools: string[];
};

export const CAPABILITY_CATALOG: Record<CapabilityId, CapabilityDef> = {
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

// Force-adds the 'chat' capability (needed for --permission-prompt-tool to
// work) if it's missing. Returns a new array; does not mutate input.
export const ensureChatCapability = (capabilities: string[]): string[] => {
  if (capabilities.includes("chat")) return [...capabilities];
  return [...capabilities, "chat"];
};

// Translates capability IDs into the flat deduplicated list of Claude tool
// names. Unknown capability IDs are silently dropped (logged elsewhere if
// needed) so a stale capabilities_json from a future version doesn't crash
// spawn.
export const capabilitiesToTools = (capabilities: string[]): string[] => {
  const out = new Set<string>();
  for (const id of capabilities) {
    const def = CAPABILITY_CATALOG[id as CapabilityId];
    if (def === undefined) continue;
    for (const t of def.tools) out.add(t);
  }
  return Array.from(out);
};

// Full resolver: ensures the chat safety-net and returns the flat tool list.
// This is the function the orchestrator should call when building spawn args.
export const resolveCapabilityTools = (capabilities: string[]): string[] => {
  return capabilitiesToTools(ensureChatCapability(capabilities));
};
```

- [ ] **Step 3: Update the barrel export in `packages/shared/src/index.ts`**

Change line 3 from `export * from "./skills.js";` to:

```typescript
export * from "./capabilities.js";
```

- [ ] **Step 4: Update `packages/shared/tests/capabilities.test.ts`**

In the renamed test file, update the import on lines 2-8 and every reference in the test bodies, applying the symbol map: `KNOWN_CLAUDE_TOOLS` (unchanged), `SKILL_CATALOG`→`CAPABILITY_CATALOG`, `ensureChatSkill`→`ensureChatCapability`, `skillsToTools`→`capabilitiesToTools`, `resolveSkillTools`→`resolveCapabilityTools`. Update `describe`/`it` titles that say "skill" to say "capability". The import path becomes `../src/capabilities.js` if it was `../src/skills.js`.

- [ ] **Step 5: Update `apps/main/src/ipc/roles-handlers.ts`**

Line 3 import: `resolveSkillTools` → `resolveCapabilityTools`. Line 24: `resolveSkillTools(role.defaultSkills)` → `resolveCapabilityTools(role.defaultSkills)`. (The `.defaultSkills` property is renamed later in Task 4 — leave it for now.)

- [ ] **Step 6: Update `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`**

Line 1 import: `resolveSkillTools` → `resolveCapabilityTools`. Line 19: `const allowedTools = resolveSkillTools(agent.skills);` → `const allowedTools = resolveCapabilityTools(agent.skills);` (leave `agent.skills` — Task 4).

- [ ] **Step 7: Update `apps/main/src/orchestrator/system-prompt.ts`**

Line 5 import: `ensureChatSkill, resolveSkillTools` → `ensureChatCapability, resolveCapabilityTools`. Lines 38-39: `ensureChatSkill(args.skills)` → `ensureChatCapability(args.skills)` and `resolveSkillTools(args.skills)` → `resolveCapabilityTools(args.skills)` (leave `args.skills` and the local var names — Task 4).

- [ ] **Step 8: Update `apps/renderer/src/components/agent-panel/ConfigTab.tsx`**

Lines 3-9 import block: `SKILL_CATALOG` → `CAPABILITY_CATALOG`. Line 72: `Object.keys(SKILL_CATALOG)` → `Object.keys(CAPABILITY_CATALOG)` (leave the `allSkillIds` var name — Task 5).

- [ ] **Step 9: Update `apps/renderer/src/components/skills/RoleDetail.tsx`**

Line 4 import: `SKILL_CATALOG` → `CAPABILITY_CATALOG`. Line 20: `SKILL_CATALOG[id as keyof typeof SKILL_CATALOG]` → `CAPABILITY_CATALOG[id as keyof typeof CAPABILITY_CATALOG]`. (The file move to `components/roles/` happens in Task 6.)

- [ ] **Step 10: Run typecheck and tests**

Run: `pnpm typecheck`
Expected: PASS (all packages, no errors)

Run: `pnpm --filter @prospero/shared test`
Expected: PASS (the renamed `capabilities.test.ts` passes)

Run: `pnpm test`
Expected: PASS (973 tests — nothing else changed behavior)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor(m11): rename skills module to capabilities"
```

---

## Task 2: Database column rename (migration 0017)

**Files:**
- Create: `apps/main/src/db/migrations/0017_rename_skills_to_capabilities.sql`
- Create: `apps/main/tests/db.migration-0017.test.ts`
- Modify: `apps/main/src/db/post-migrations/0004.ts`
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/src/agents/role-templates-repository.ts`
- Modify: `apps/main/src/mcp/tools.ts`
- Modify: `apps/main/tests/db.post-migration-0004.test.ts`
- Modify: every other test file inserting these columns (see Step 6)
- Modify: `tests/e2e/helpers/seed.ts`

- [ ] **Step 1: Write the failing migration test**

Create `apps/main/tests/db.migration-0017.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";

const columnNames = (db: Database.Database, table: string): string[] =>
  (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

describe("migration 0017 — rename skills columns to capabilities", () => {
  it("renames agents.skills_json to capabilities_json", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnNames(db, "agents");
    expect(cols).toContain("capabilities_json");
    expect(cols).not.toContain("skills_json");
  });

  it("renames role_templates.default_skills_json to default_capabilities_json", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = columnNames(db, "role_templates");
    expect(cols).toContain("default_capabilities_json");
    expect(cols).not.toContain("default_skills_json");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @prospero/main exec vitest run tests/db.migration-0017.test.ts`
Expected: FAIL — `expect(cols).toContain("capabilities_json")` fails because migration `0017` does not exist yet (column is still `skills_json`).

- [ ] **Step 3: Create the migration**

Create `apps/main/src/db/migrations/0017_rename_skills_to_capabilities.sql`:

```sql
-- M11 PR-A: free the name "skill" for M11 procedural-knowledge docs.
-- The M7 tool-bundle concept is renamed "capability".
ALTER TABLE agents RENAME COLUMN skills_json TO capabilities_json;
ALTER TABLE role_templates RENAME COLUMN default_skills_json TO default_capabilities_json;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @prospero/main exec vitest run tests/db.migration-0017.test.ts`
Expected: PASS

- [ ] **Step 5: Update `apps/main/src/db/post-migrations/0004.ts`**

Post-migrations run *after* all SQL migrations, so on a fresh database `0004` seeds rows into the already-renamed columns. Apply throughout the file:
- `RoleSeed` type field (line 21): `default_skills_json` → `default_capabilities_json`
- The 5 role literals (lines 33, 43, 53, 63, 73): property key `default_skills_json` → `default_capabilities_json`
- `upsertRole` SQL (lines 86-87): column `default_skills_json` → `default_capabilities_json` and named param `@default_skills_json` → `@default_capabilities_json`
- `setAgentRole` SQL (line 92): `SET template_id = ?, skills_json = ?, model = ?` → `SET template_id = ?, capabilities_json = ?, model = ?`
- Line 110: `role.default_skills_json` → `role.default_capabilities_json`
- Comment line 8: "skills" → "capabilities"

- [ ] **Step 6: Rename the column in all main-app source and test files**

In `apps/main/src/` and `apps/main/tests/` and `tests/e2e/`, replace the literal column tokens everywhere they appear in SQL strings, Row types, and `JSON.parse`/property reads:
- `default_skills_json` → `default_capabilities_json`
- `skills_json` → `capabilities_json`

Known locations (verify with `git grep -n "skills_json"` after editing — there must be **zero** matches left except inside `migrations/0001`–`0016` SQL files and `migrations/0017`'s `RENAME COLUMN ... skills_json`):
- `apps/main/src/agents/repository.ts` — Row type field, `INSERT INTO agents (... skills_json ...)`, `UPDATE agents SET skills_json = ?`, `SELECT default_skills_json FROM role_templates`, and the `JSON.parse(r.skills_json)` / `JSON.parse(row.skills_json)` reads
- `apps/main/src/agents/role-templates-repository.ts` — Row type field `default_skills_json`, `rowToRole` parse, both `SELECT` statements
- `apps/main/src/mcp/tools.ts` — `SELECT default_skills_json ... FROM role_templates` and `JSON.parse(row.default_skills_json)`
- `apps/main/tests/db.post-migration-0004.test.ts` — the `seedAgent` helper INSERT, the `skillsJson` option threading (rename the option to `capabilitiesJson` too), and every `default_skills_json` / `skills_json` in SELECTs and assertions
- `apps/main/src/agents/repository.test.ts`, `apps/main/src/agents/repository.lifecycle.test.ts`
- `apps/main/src/mcp/tools-goals.test.ts`, `apps/main/src/mcp/tools-goals-narrated.test.ts`
- `apps/main/tests/ipc.roles-handlers.test.ts`, `apps/main/tests/mcp.tools.test.ts`, `apps/main/tests/role-templates.repository.test.ts`
- `apps/main/tests/integration/goal-narrated-abort.test.ts`, `apps/main/tests/integration/goal-narrated-flow.test.ts`
- `apps/main/tests/db.migration-0003.test.ts`, `apps/main/tests/db.post-migration-0003.test.ts` (only if they reference the columns — `git grep` will tell)
- `tests/e2e/helpers/seed.ts`

Do **not** edit `apps/main/src/db/migrations/0001_initial.sql` or `0010_agents_paused_terminated.sql` — those are historical.

- [ ] **Step 7: Run typecheck and the full test suite**

Run: `git grep -n "skills_json" -- apps packages tests`
Expected: matches ONLY in `apps/main/src/db/migrations/0001_initial.sql`, `0010_agents_paused_terminated.sql`, and `0017_rename_skills_to_capabilities.sql`.

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS (973 + 2 new migration tests = 975)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(m11): rename skills_json db columns to capabilities_json"
```

---

## Task 3: Activity action `agent.skills_changed` → `agent.capabilities_changed`

**Files:**
- Modify: `packages/shared/src/types/activity.ts`
- Modify: `apps/main/src/activity/schemas.ts`
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/src/agents/repository.lifecycle.test.ts`

- [ ] **Step 1: Rename the action in the shared type**

In `packages/shared/src/types/activity.ts`, in the `ACTIVITY_ACTIONS` array (line ~27), change `"agent.skills_changed"` to `"agent.capabilities_changed"`.

- [ ] **Step 2: Rename the zod schema key**

In `apps/main/src/activity/schemas.ts` (lines ~29-32), change the schema map key:

```typescript
"agent.capabilities_changed": z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
}),
```

- [ ] **Step 3: Update the emit site in `apps/main/src/agents/repository.ts`**

In the `setSkills` method (lines ~319-340), the `recordActivity(...)` call uses `action: "agent.skills_changed"` — change it to `action: "agent.capabilities_changed"`. (The `setSkills` *method name* and its `skills` parameter are renamed in Tasks 4/5 — leave them here.)

- [ ] **Step 4: Update the test filter**

In `apps/main/src/agents/repository.lifecycle.test.ts` (line ~61), change `filters: { action: "agent.skills_changed" }` to `filters: { action: "agent.capabilities_changed" }`.

- [ ] **Step 5: Verify there are no remaining references**

Run: `git grep -n "skills_changed" -- apps packages`
Expected: zero matches (the i18n label `skills_changed` is renamed in Task 7 — if `git grep` shows it in the locale JSON files, that is expected and handled later).

Correction: the i18n locale files DO still contain `skills_changed` at this point. Restrict the check:

Run: `git grep -n "skills_changed" -- apps/main/src apps/main/tests packages/shared`
Expected: zero matches.

- [ ] **Step 6: Run typecheck and tests**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(m11): rename agent.skills_changed activity action"
```

---

## Task 4: Type properties `.skills` / `.defaultSkills` → `.capabilities` / `.defaultCapabilities`

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/types/role.ts`
- Modify: `packages/shared/src/types/goal.ts`
- Modify: `apps/main/src/orchestrator/system-prompt.ts`
- Modify: `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`
- Modify: `apps/main/src/ipc/roles-handlers.ts`
- Modify: `apps/main/src/agents/repository.ts`
- Modify: `apps/main/src/agents/role-templates-repository.ts`
- Modify: `apps/main/src/goals/executor.ts`
- Modify: `apps/main/src/mcp/tools.ts` (if it maps a `skills`/`defaultSkills` property)
- Modify: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`
- Modify: `apps/renderer/src/components/skills/RoleDetail.tsx`
- Modify: all test files with `skills:` / `defaultSkills:` fixtures (see Step 9)

- [ ] **Step 1: Rename the `Agent` type property**

In `packages/shared/src/types/agent.ts` line 31, change `skills: string[];` to `capabilities: string[];`.

- [ ] **Step 2: Rename the `RoleTemplate` type property**

In `packages/shared/src/types/role.ts`:
- Line 10: `defaultSkills: string[];` → `defaultCapabilities: string[];`
- Update the header comments (lines 1-4, 15): "Skills are canonical IDs from packages/shared/src/skills.ts" → "Capabilities are canonical IDs from packages/shared/src/capabilities.ts"; "/skills UI" → "/roles UI".

- [ ] **Step 3: Rename the `AgentToHire` property**

In `packages/shared/src/types/goal.ts` line 46, change `skills: string[];` to `capabilities: string[];`.

- [ ] **Step 4: Rename `ComposeArgs.skills` and update `system-prompt.ts`**

In `apps/main/src/orchestrator/system-prompt.ts`:
- Line 29 (`ComposeArgs` type): `skills: string[];` → `capabilities: string[];`
- Lines 38-39: `ensureChatCapability(args.skills)` → `ensureChatCapability(args.capabilities)`; `resolveCapabilityTools(args.skills)` → `resolveCapabilityTools(args.capabilities)`
- Line 38 local var: `effectiveSkills` → `effectiveCapabilities`
- Lines 46-58: rename the `skillsBlock` const to `capabilitiesBlock`, update line 61 (`preamble + roleBlock + ... + skillsBlock + ...` → `... + capabilitiesBlock + ...`), and rewrite the block prose:

```typescript
  const capabilitiesBlock = `
---

# Your capabilities and available tools

You have the following capabilities: ${effectiveCapabilities.join(", ")}.

The host has filtered your visible Claude tools to: ${resolvedTools.join(", ")}.

Tools outside this list are not available to you and will fail if you attempt
to call them. If you need a capability you don't have, ask the user to update
your role.
`;
```

- Lines 67-68 (`buildAgentSystemPrompt` wrapper): rename the `skills` parameter to `capabilities` and update the call `composeSystemPrompt({ agentPersona: userSystemPrompt, capabilities })`.

- [ ] **Step 5: Update `build-args.ts`**

In `apps/main/src/orchestrator/adapters/claude-oauth-local/build-args.ts`:
- Line 19: `resolveCapabilityTools(agent.skills)` → `resolveCapabilityTools(agent.capabilities)`
- Line 26 (inside `composeSystemPrompt({...})`): `skills: agent.skills,` → `capabilities: agent.capabilities,`

- [ ] **Step 6: Update `roles-handlers.ts`**

In `apps/main/src/ipc/roles-handlers.ts` line 24: `resolveCapabilityTools(role.defaultSkills)` → `resolveCapabilityTools(role.defaultCapabilities)`.

- [ ] **Step 7: Update the main repositories**

In `apps/main/src/agents/repository.ts`:
- The Row→Agent mapping: `skills: JSON.parse(r.capabilities_json) as string[]` → `capabilities: JSON.parse(r.capabilities_json) as string[]`
- INSERT param: `JSON.stringify(input.skills ?? [])` → `JSON.stringify(input.capabilities ?? [])`
- The `setSkills` method: rename to `setCapabilities`; rename its `skills` parameter to `capabilities`; update the local `JSON.parse(...)` previous-value var and the `added`/`removed` diff to read from `capabilities`; the `recordActivity` payload keys `added`/`removed` stay.

In `apps/main/src/agents/role-templates-repository.ts` line 19: `defaultSkills: JSON.parse(r.default_capabilities_json) as string[]` → `defaultCapabilities: JSON.parse(r.default_capabilities_json) as string[]`.

- [ ] **Step 8: Update `executor.ts` and `tools.ts`**

In `apps/main/src/goals/executor.ts` (line ~120), the `AgentToHire` mapping `skills: a.skills` → `capabilities: a.capabilities`.

In `apps/main/src/mcp/tools.ts`, if the parsed role default is assigned to a `skills`/`defaultSkills` property or passed as a `skills:` field when creating an agent, rename it to `capabilities`. Verify with `git grep -n "skills" -- apps/main/src/mcp/tools.ts`.

- [ ] **Step 9: Update the renderer property reads**

In `apps/renderer/src/components/agent-panel/ConfigTab.tsx`:
- Lines 76-80: `agentSkills: agent.skills` → `agentSkills: agent.capabilities`; `roleDefaultSkills: currentRole?.defaultSkills ?? []` → `roleDefaultSkills: currentRole?.defaultCapabilities ?? []` (the `categorizeSkills` *input field names* are renamed in Task 5)
- Line 80 dependency array: `agent.skills` → `agent.capabilities`, `currentRole?.defaultSkills` → `currentRole?.defaultCapabilities`
- Lines 293-294 + 310: `[...agent.skills, s.id]` / `agent.skills.filter(...)` / `[...agent.skills, v]` → `agent.capabilities`

In `apps/renderer/src/components/skills/RoleDetail.tsx` lines 16-22: `detail.defaultSkills` → `detail.defaultCapabilities` (both the spread and the dependency array).

- [ ] **Step 10: Update all test fixtures**

Run `git grep -ln "defaultSkills\|skills:" -- apps packages tests` and in each hit replace the **object-property** uses:
- `defaultSkills:` → `defaultCapabilities:`
- `skills: [` (in `Agent` / `AgentToHire` / hire-input fixtures) → `capabilities: [`

Known files: `apps/main/src/agents/repository.test.ts`, `apps/main/src/agents/repository.lifecycle.test.ts`, `apps/main/src/goals/executor.test.ts` (line ~38), `apps/main/src/goals/format-execute-request.test.ts` (lines ~35, 94, 104), `apps/main/tests/role-templates.repository.test.ts`, `apps/main/tests/mcp.tools.test.ts`, `apps/main/tests/ipc.roles-handlers.test.ts`, `tests/e2e/helpers/seed.ts`. Inspect each match — only rename properties on Agent/Role/AgentToHire shapes; do not touch unrelated identifiers.

- [ ] **Step 11: Run typecheck and tests**

Run: `pnpm typecheck`
Expected: PASS — TypeScript flags any property read still using `.skills` / `.defaultSkills`, so a clean typecheck proves Step 10 was complete.

Run: `pnpm test`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(m11): rename agent skills property to capabilities"
```

---

## Task 5: `skillCategorize` module + agents store `setSkills`

**Files:**
- Rename: `apps/renderer/src/components/agent-panel/skillCategorize.ts` → `capabilityCategorize.ts`
- Rename: `apps/renderer/src/components/agent-panel/skillCategorize.test.ts` → `capabilityCategorize.test.ts`
- Modify: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`
- Modify: `apps/renderer/src/stores/agents.ts`
- Modify: `packages/shared/src/ipc-channels.ts` + the agents IPC handler + preload bridge (see Step 5)

- [ ] **Step 1: Move the files with git**

```bash
git mv apps/renderer/src/components/agent-panel/skillCategorize.ts apps/renderer/src/components/agent-panel/capabilityCategorize.ts
git mv apps/renderer/src/components/agent-panel/skillCategorize.test.ts apps/renderer/src/components/agent-panel/capabilityCategorize.test.ts
```

- [ ] **Step 2: Replace the content of `capabilityCategorize.ts`**

```typescript
export interface CapabilityRow {
  id: string;
  enabled: boolean;
}

export interface CategorizedCapabilities {
  required: CapabilityRow[];
  optional: CapabilityRow[];
  available: string[];
}

export interface CategorizeInput {
  agentCapabilities: string[];
  roleDefaultCapabilities: string[];
  allCapabilities: string[];
}

export const categorizeCapabilities = (input: CategorizeInput): CategorizedCapabilities => {
  const agentSet = new Set(input.agentCapabilities);
  const defaultsSet = new Set(input.roleDefaultCapabilities);

  const required: CapabilityRow[] = input.roleDefaultCapabilities.map((id) => ({
    id,
    enabled: agentSet.has(id),
  }));
  const optional: CapabilityRow[] = input.agentCapabilities
    .filter((id) => !defaultsSet.has(id))
    .map((id) => ({ id, enabled: true }));
  const available = input.allCapabilities.filter(
    (id) => !agentSet.has(id) && !defaultsSet.has(id),
  );

  return { required, optional, available };
};
```

- [ ] **Step 3: Update `capabilityCategorize.test.ts`**

In the renamed test file, update the import to `./capabilityCategorize.js`, and rename throughout: `categorizeSkills`→`categorizeCapabilities`, `SkillRow`→`CapabilityRow`, `CategorizedSkills`→`CategorizedCapabilities`, input fields `agentSkills`→`agentCapabilities` / `roleDefaultSkills`→`roleDefaultCapabilities` / `allSkills`→`allCapabilities`. Update `describe`/`it` titles mentioning "skill" to "capability".

- [ ] **Step 4: Update `ConfigTab.tsx`**

In `apps/renderer/src/components/agent-panel/ConfigTab.tsx`:
- Line 15 import: `import { categorizeSkills } from "./skillCategorize.js";` → `import { categorizeCapabilities } from "./capabilityCategorize.js";`
- Line 72: rename var `allSkillIds` → `allCapabilityIds`
- Lines 73-81: rename var `categorizedSkills` → `categorizedCapabilities`; call `categorizeCapabilities({ agentCapabilities: agent.capabilities, roleDefaultCapabilities: currentRole?.defaultCapabilities ?? [], allCapabilities: allCapabilityIds })`
- Lines 267-321: every `categorizedSkills.` → `categorizedCapabilities.`
- Line 28: store selector `const setSkills = useAgentsStore((s) => s.setSkills);` → `const setCapabilities = useAgentsStore((s) => s.setCapabilities);`
- Lines 295, 310: `setSkills(agent.id, next)` / `setSkills(agent.id, [...agent.capabilities, v])` → `setCapabilities(...)`

- [ ] **Step 5: Rename `setSkills` through the IPC layer**

In `apps/renderer/src/stores/agents.ts`, rename the `setSkills` store action (type declaration ~line 24 and implementation ~lines 114-115) to `setCapabilities`; rename its `skills` parameter to `capabilities`.

The store calls into the preload bridge, which calls an IPC channel handled in main. Find the whole chain with:

```bash
git grep -in "setskills\|set_skills\|skills" -- packages/shared/src/ipc-channels.ts apps/main/src/ipc apps/main/src/preload.ts apps/renderer/src/preload
```

For every hit that is the "set agent skills" path, rename: the IPC channel constant (e.g. `AGENTS_SET_SKILLS` → `AGENTS_SET_CAPABILITIES`) and its string value, the `ipcMain.handle` registration, the preload bridge method (`setSkills` → `setCapabilities`), and the `window.prospero.agents.*` type in the renderer's window typings. The main handler ultimately calls `repository.setCapabilities` (renamed in Task 4).

- [ ] **Step 6: Run typecheck and tests**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(m11): rename skill categorize module and setSkills action"
```

---

## Task 6: Route `/skills` → `/roles`, file & component moves

**Files:**
- Rename: `apps/renderer/src/routes/Skills.tsx` → `apps/renderer/src/routes/Roles.tsx`
- Rename: `apps/renderer/src/components/skills/RoleDetail.tsx` → `apps/renderer/src/components/roles/RoleDetail.tsx`
- Rename: `apps/renderer/src/components/skills/RoleListItem.tsx` → `apps/renderer/src/components/roles/RoleListItem.tsx`
- Modify: `apps/renderer/src/App.tsx`

- [ ] **Step 1: Move the files with git**

```bash
git mv apps/renderer/src/routes/Skills.tsx apps/renderer/src/routes/Roles.tsx
mkdir apps/renderer/src/components/roles
git mv apps/renderer/src/components/skills/RoleDetail.tsx apps/renderer/src/components/roles/RoleDetail.tsx
git mv apps/renderer/src/components/skills/RoleListItem.tsx apps/renderer/src/components/roles/RoleListItem.tsx
```

(The now-empty `apps/renderer/src/components/skills/` directory should disappear after the moves; if it lingers, remove it.)

- [ ] **Step 2: Update `Roles.tsx`**

In `apps/renderer/src/routes/Roles.tsx`:
- Rename the exported component `Skills` → `Roles` (the `export const Roles: FC = () => {`)
- Update the two component imports to the new path: `"../components/roles/RoleListItem.js"` and `"../components/roles/RoleDetail.js"`
- Leave the `t("skills.*")` calls as-is — i18n keys are renamed in Task 7.

- [ ] **Step 3: Update `App.tsx`**

In `apps/renderer/src/App.tsx`:
- Line 21 import: `import { Skills } from "./routes/Skills.js";` → `import { Roles } from "./routes/Roles.js";`
- Lines 120-127 (sidebar `NavLink`): `to="/skills"` → `to="/roles"`; leave `{t("nav.skills")}` (renamed in Task 7)
- Lines 380-391 (the `<Route>`): `path="/skills"` → `path="/roles"`; `<Skills />` → `<Roles />`

- [ ] **Step 4: Check for other references to the old paths**

Run: `git grep -n "routes/Skills\|components/skills\|\"/skills\"\|'/skills'" -- apps`
Expected: zero matches.

- [ ] **Step 5: Run typecheck and tests**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(m11): rename skills route to roles"
```

---

## Task 7: i18n keys

**Files:**
- Modify: `apps/renderer/src/i18n/en-US.json`
- Modify: `apps/renderer/src/i18n/pt-BR.json`
- Modify: `apps/renderer/src/routes/Roles.tsx`
- Modify: `apps/renderer/src/components/roles/RoleDetail.tsx`
- Modify: `apps/renderer/src/components/roles/RoleListItem.tsx`
- Modify: `apps/renderer/src/components/agent-panel/ConfigTab.tsx`
- Modify: `apps/renderer/src/App.tsx`
- Modify: the activity-event renderer that displays `capabilities_changed` (see Step 4)

- [ ] **Step 1: Rename keys in both locale files**

In `apps/renderer/src/i18n/en-US.json` and `apps/renderer/src/i18n/pt-BR.json`, apply these renames (keep every value identical *except* where noted):
- `nav.skills` → `nav.roles` — set value to `"Roles"` (en) / `"Funções"` (pt)
- top-level `skills` object → rename the key to `roles` (keep all nested keys/values: `title`, `subtitle`, `empty`, `agentsCount`, `detail.*`). Inside it, rename `detail.skillsGroup` → `detail.capabilityGroup` and change its interpolation placeholder from `{{skill}}` to `{{capability}}`.
- `agent.config.skills` → `agent.config.capabilities`
- `agent.config.skillsEdit` → `agent.config.capabilitiesEdit`
- `plan.agentFields.skills` → `plan.agentFields.capabilities`
- the activity label `skills_changed` → `capabilities_changed` (update the sentence to read "capabilities" instead of "skills")

Then run `git grep -in "skill" -- apps/renderer/src/i18n` and resolve any remaining occurrence (e.g. a stray standalone `"skills"` value string) — there must be no `skill` token left in either locale file.

- [ ] **Step 2: Update `t()` call sites for the renamed page keys**

- `apps/renderer/src/routes/Roles.tsx`: `t("skills.title")` → `t("roles.title")`, `t("skills.subtitle")` → `t("roles.subtitle")`, `t("skills.empty")` → `t("roles.empty")`
- `apps/renderer/src/components/roles/RoleListItem.tsx`: `t("skills.agentsCount", ...)` → `t("roles.agentsCount", ...)`
- `apps/renderer/src/components/roles/RoleDetail.tsx`: `t("skills.detail.defaultModel")` → `t("roles.detail.defaultModel")`, `t("skills.detail.tools")` → `t("roles.detail.tools")`, `t("skills.detail.agentsUsing")` → `t("roles.detail.agentsUsing")`, `t("skills.detail.noAgents")` → `t("roles.detail.noAgents")`, and `t("skills.detail.skillsGroup", { skill: skill.id })` → `t("roles.detail.capabilityGroup", { capability: capability.id })`. Also rename the `grouped.map((skill) => ...)` local param to `capability` for consistency (line 48 onward).
- `apps/renderer/src/App.tsx`: `t("nav.skills")` → `t("nav.roles")`

- [ ] **Step 3: Update `t()` call sites in ConfigTab**

In `apps/renderer/src/components/agent-panel/ConfigTab.tsx`:
- `t("agent.config.skills.label")` → `t("agent.config.capabilities.label")`
- `t("agent.config.skillsEdit.required")` → `t("agent.config.capabilitiesEdit.required")`
- `t("agent.config.skillsEdit.optional")` → `t("agent.config.capabilitiesEdit.optional")`
- `t("agent.config.skillsEdit.addLabel")` → `t("agent.config.capabilitiesEdit.addLabel")`

- [ ] **Step 4: Update the activity-event label call site**

Run: `git grep -rn "skills_changed\|plan.agentFields.skills" -- apps/renderer/src`
For each remaining hit (the component that renders activity actions, and any goal-plan form using `plan.agentFields.skills`), update the `t(...)` key to `capabilities_changed` / `plan.agentFields.capabilities`.

- [ ] **Step 5: Verify no key drift**

Run: `git grep -rn "\"skills\.\|'skills\.\|skills_changed\|nav\.skills\|skillsEdit\|agentFields\.skills" -- apps/renderer/src`
Expected: zero matches.

- [ ] **Step 6: Run typecheck and tests**

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(m11): rename skills i18n keys to capabilities and roles"
```

---

## Task 8: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Global grep for stragglers**

Run: `git grep -in "skill" -- apps packages tests`
Expected: the ONLY matches are:
- `apps/main/src/db/migrations/0001_initial.sql`, `0010_agents_paused_terminated.sql` (historical SQL — `skills_json`)
- `apps/main/src/db/migrations/0017_rename_skills_to_capabilities.sql` (the `RENAME COLUMN ... skills_json` statement + filename)

Investigate and resolve anything else. (M11's *own* "skill" concept does not exist yet — it arrives in PR-B+ — so at the end of PR-A there must be no other `skill` token in source.)

- [ ] **Step 2: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Full lint**

Run: `pnpm lint`
Expected: PASS (no errors)

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: PASS — 975 tests (973 pre-existing + 2 new in `db.migration-0017.test.ts`), 2 todo.

- [ ] **Step 5: Smoke-build the renderer and main**

Run: `pnpm build`
Expected: PASS (both `@prospero/main` and `@prospero/renderer` build cleanly).

- [ ] **Step 6: Final commit (only if Steps 1-5 produced fixes)**

```bash
git add -A
git commit -m "refactor(m11): finalize skills to capabilities rename"
```

If Steps 1-5 were all clean with no edits, skip this commit.

---

## Self-Review notes

- **Spec coverage:** PR-A in the spec = "rename `skills.ts`→`capabilities.ts`, migration `0017` renaming `agents.skills_json` + `role_templates.default_skills_json`, types in `agent.ts`/`role.ts`/`goal.ts`, action `agent.capabilities_changed`, route `/skills`→`/roles`, i18n, hire form + agent studio labels, pure rename / zero behavior change." Every item maps to a task: module (T1), migration (T2), types (T4), action (T3), route (T6), i18n (T7), ConfigTab capability section = the "agent studio labels" (T4/T5/T7). Agent Studio hire form: the hire-side capability fields flow through `AgentToHire.capabilities` (T4) and the goal-plan `plan.agentFields.capabilities` i18n (T7) — covered.
- **Migration safety:** `0017` uses `ALTER TABLE ... RENAME COLUMN` (SQLite ≥ 3.25, bundled by better-sqlite3). Old migrations `0001`/`0010` are left untouched so a fresh DB creates `skills_json` then `0017` renames it; post-migration `0004` runs after all SQL migrations and is updated to seed the renamed columns.
- **Green at every commit:** each task renames a full rename-unit (symbol / column / action / property / module / route / i18n) across every file that references it, so `pnpm typecheck` + `pnpm test` pass after each task.
- **Type consistency:** new symbols are used identically everywhere — `resolveCapabilityTools`, `CAPABILITY_CATALOG`, `capabilities_json`, `Agent.capabilities`, `RoleTemplate.defaultCapabilities`, `categorizeCapabilities`, `setCapabilities`.
