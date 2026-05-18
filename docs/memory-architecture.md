# Memory architecture

> Describes the shipped M11 implementation. The earlier design spec
> (`docs/superpowers/specs/2026-05-15-m11-agent-memory-design.md`) mentioned
> per-scope `memory.md` files for company and agent declarative memory — those
> were never built. The actual storage is described below.

---

## Cognitive matrix

M11 organises persistent knowledge along two axes.

|              | Individual (per-agent) | Collective (company-wide) |
|---|---|---|
| **Declarative** | agent memory rows in `memories` table | company memory rows in `memories` table |
| **Procedural** | agent-private `SKILL.md` files + `skills` rows | company-shared `SKILL.md` files + `skills` rows |
| **Episodic** | `messages` table (FTS5-indexed) | — |

---

## What is a file and what is a DB row

Only one markdown file is managed as a first-class user document:

- **`<userData>/memory/user.md`** — the "About the user" slot. Written directly
  by the user in Settings. Never touched by agents.

All declarative memory (company and per-agent facts, rules, preferences,
retrospectives) are rows in the `memories` SQLite table, not files. Agents
write to this table through MCP tools (`memory_add`, `memory_remove`).

Skill **bodies** are markdown files at
`<userData>/memory/companies/<id>/agents/<agentId>/skills/<name>/SKILL.md` for
agent-private skills, and
`<userData>/memory/companies/<id>/skills/<name>/SKILL.md` for company-shared
skills. Skill **metadata** (name, description, trust, use count, scope, etc.)
are rows in the `skills` table. The `body_path` column on each row points to
the on-disk file.

Source: `apps/main/src/memory/memory-dir.ts`, `apps/main/src/memory/memories-repository.ts`,
`apps/main/src/memory/skills-repository.ts`.

---

## System-prompt slots and caps

`buildMemoryBlock` in `apps/main/src/orchestrator/system-prompt-memory.ts`
assembles the memory section and injects it once at agent spawn. Four slots:

| Slot | Cap (chars) | Source |
|---|---|---|
| About the user | 1 024 | `user.md`, hard-truncated at injection |
| Company memory | 1 536 | `memories` rows: company-global + role-scoped |
| Your memory | 1 024 | `memories` rows: agent-private |
| Your skills (L0) | 4 096 | `skills` rows: name + one-line description |

Total additional system-prompt overhead: approximately 7.5 KB when all slots
are full.

---

## L0 priority and trust filter

The skills L0 block renders entries sorted by `use_count` descending, then
`trust` descending. Entries with `trust < 0.2` are excluded from the L0 block
entirely — they remain reachable on demand via `skill_read` and
`memory_search`. The same `0.2` threshold applies to declarative memory rows.

Source: `system-prompt-memory.ts`, constant `MIN_L0_TRUST = 0.2`.

---

## Decay and maintenance

A once-per-session boot pass runs via `runMemoryMaintenance` in
`apps/main/src/memory/maintenance.ts`. It is throttled to at most once every
20 hours to avoid running repeatedly during rapid app restarts.

The pass applies a 90-day importance half-life to all non-pinned,
non-`identity` memory rows. Frequency of access stretches the effective
half-life: each access adds 10% to the half-life multiplier, capped at 20
accesses (3x max stretch). The math is in `apps/main/src/memory/decay.ts`.

When importance falls below `0.2`, the maintenance pass posts a
`memory_review_needed` inbox notice ("Memory fading"). When importance falls
below `0.1` **and** the entry has not been accessed in 30 days, the entry is
soft-deleted and a second `memory_review_needed` notice is posted ("Memory
pruned").

For skills: soft-deleted skill rows (created by the terminate-modal cascade or
by the agent) are hard-deleted (purged from the database) once their
`soft_deleted_at` timestamp is more than 30 days old. The associated `SKILL.md`
file is left in place; it becomes unreachable once the row is gone.

---

## Trust feedback

The user can thumb-up or thumb-down a memory entry or skill from the Learning
tab. Trust deltas: `+0.05` for thumb-up, `-0.10` for thumb-down. Values are
clamped to `[0, 1]`.

Source: `apps/main/src/ipc/learning-handlers.ts`, constant `TRUST_DELTA`.

---

## The `user.md` editor

Settings → Memory exposes a plain-text editor backed by two IPCs:
`memory:user-read` (reads `user.md` from disk) and `memory:user-write` (writes
it). The file is written verbatim — no sanitizer runs on user-authored content.
See SECURITY.md, "Memory and skills as injection vectors", for why the
sanitizer is deliberately not run on `user.md`. Changes take effect at the next
agent spawn; agents already running are not affected.
