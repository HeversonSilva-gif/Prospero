# Skills format

---

## What a skill is

A skill encodes reusable procedural knowledge that an agent can load on demand
when starting a task. Skills are not the M7 "capabilities" (tool
bundles — see `apps/main/src/mcp/`). M11 PR-A renamed that concept from
"skill" to "capability" in the UI and codebase specifically to free the word
"skill" for the procedural-memory concept described here.

---

## Storage layout

A skill has two components:

1. **A `SKILL.md` body file** on disk. This is freeform markdown — how the
   agent wrote it, with no required frontmatter. The path is stored in the
   `skills.body_path` column and follows the pattern:

   - Agent-private: `<userData>/memory/companies/<companyId>/agents/<agentId>/skills/<name>/SKILL.md`
   - Company-shared: `<userData>/memory/companies/<companyId>/skills/<name>/SKILL.md`

2. **A row in the `skills` table** with metadata. Key columns:

| Column | Type | Description |
|---|---|---|
| `id` | `TEXT` | Primary key, `skill_<uuid>` |
| `company_id` | `TEXT` | FK to `companies` |
| `agent_id` | `TEXT \| NULL` | NULL for company-shared skills |
| `name` | `TEXT` | Kebab-case identifier, unique within scope |
| `description` | `TEXT` | One-line summary shown in the L0 system-prompt block |
| `body_path` | `TEXT` | Absolute path to the `SKILL.md` file |
| `version` | `INTEGER` | Incremented on each `skill_update` |
| `applies_to_role` | `TEXT \| NULL` | Non-NULL for role-scoped shared skills |
| `source` | `TEXT` | One of `agent_created`, `derived_from_issue`, `derived_from_recovery`, `user_authored` |
| `trust` | `REAL` | `[0, 1]`, default `0.5` |
| `use_count` | `INTEGER` | Incremented each time `skill_read` is called |
| `promoted` | `INTEGER` | `1` when approved via the promotion flow |
| `soft_deleted` | `INTEGER` | `1` when soft-deleted |
| `soft_deleted_at` | `INTEGER \| NULL` | Unix ms timestamp of soft-deletion |

Source: `apps/main/src/memory/skills-repository.ts`.

---

## Scopes

Three scopes are distinguished by `agent_id` and `applies_to_role`:

- **Agent-private** — `agent_id` set, `applies_to_role` NULL. Only the
  owning agent sees the skill.
- **Role-scoped** — `agent_id` NULL, `applies_to_role` set. Inherited by all
  agents whose role matches.
- **Company-global** — `agent_id` NULL, `applies_to_role` NULL. Inherited by
  every agent in the company.

`buildMemoryBlock` (invoked at spawn) merges agent-private + role-scoped +
company-global into the single L0 skills block, deduplicated by insertion order.

---

## MCP tools

Agents interact with skills through five tools registered in
`apps/main/src/mcp/tools-memory.ts`:

| Tool | Description |
|---|---|
| `skill_search` | Keyword search over name and description; returns L0 entries |
| `skill_read` | Reads the full `SKILL.md` body by name; records a use |
| `skill_create` | Creates a new agent-private skill; enforces rate limit (5 writes / 2 min) |
| `skill_update` | Replaces the body of an existing private skill; increments version |
| `skill_promote` | Files a promotion request (inbox item) for the user to approve |

All write tools run the body through `sanitizeMemoryBody` before persisting.
Promoted skills are read-only to the agent — `skill_update` rejects them.

---

## The bundled operating manual

One skill is not stored in the `skills` table at all: `operating-manual`. It is
a compiled-in document (`apps/main/src/orchestrator/operating-manual.ts`)
shipped with the app — the company-wide playbook for the issue lifecycle,
artifacts, delegation, cost discipline, and goal-plan mechanics.

It behaves like a company-global skill from an agent's point of view:
`buildMemoryBlock` injects its L0 entry into every agent's `## Your skills`
block, and `skill_read` serves its body on demand. It has no row, no
`body_path`, and no per-company state. The name `operating-manual` is
**reserved** — `skill_create` rejects it so a real skill cannot shadow it.

---

## Body cap and sanitizer

The body of a skill is capped at **16 384 characters** (16 KB) by the Zod
schema on `skill_create` and `skill_update`. The description field (L0 text)
is capped at 200 characters.

`sanitizeMemoryBody` in `apps/main/src/memory/sanitizer.ts` blocks
prompt-injection patterns (e.g. "ignore previous instructions"), blocked shell
command patterns from `gate.ts`, and sensitive filesystem paths. It runs on
both the body and the description.

---

## Promotion flow

An agent calls `skill_promote` to nominate one of its private skills for
company sharing. The tool creates an inbox item of kind
`skill_promotion_requested`. The user sees it in the Inbox, opens the approval
modal (showing the full skill body), and chooses a scope (`applies_to_role` or
company-global). On approval, `skills-repository.promote()` sets
`agent_id = NULL` and records `promoted = 1`.

A second path exists in the terminate modal (PR-F2): when the user terminates
an agent, a checklist of that agent's private skills is shown. Skills the user
checks are promoted before the agent is terminated; unchecked skills are
soft-deleted. Skills that remain soft-deleted for 30 days are hard-purged by
the maintenance pass.

---

## Lifecycle after termination

When an agent is terminated without promoting a skill, `softDelete()` is called
with the current timestamp stored in `soft_deleted_at`. The maintenance pass
(which runs once per session at boot) hard-deletes rows where
`soft_deleted = 1 AND soft_deleted_at < now - 30 days`. The `SKILL.md` file on
disk is not removed by the purge; it becomes unreachable once the row is gone.
