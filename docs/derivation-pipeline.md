# Derivation pipeline

The derivation pipeline converts completed agent work into reviewable skill
candidates and company memory entries. It runs asynchronously and is capped to
a configurable number of runs per agent per day.

---

## Triggers

The dispatcher (`apps/main/src/derivation/dispatcher.ts`) listens to each
written `activity_events` row. Four actions trigger a derivation job:

| Activity action | Trigger name | Output kind |
|---|---|---|
| `issue.status_changed` where `to = "done"` | `issue_done` | `skill_candidate` |
| `agent.recovered` | `recovery` | `skill_candidate` |
| `goal.status_changed` where `to = "achieved"` | `goal_achieved` | company `retrospective` memory |
| `approval.rejected` | `approval_rejected` | agent `preference` memory |

The dispatcher never blocks the activity write — it enqueues the job and
drains the queue asynchronously via a sequential FIFO runner.

---

## Daily cap

Before processing any job the worker reads `settings.derivationsPerDayPerAgent`
(default: `3`). It counts `cost_events` rows for that agent with
`adapter_name = 'derivation'` since the start of the current UTC calendar day.
If the count meets or exceeds the cap the job is silently dropped. The setting
is editable in Settings.

---

## Trail construction

Each trigger builds a "trail" — the minimal context needed for a useful
derivation prompt:

- **`issue_done`** — collects the issue title, description, comments, and
  associated artifacts from the database.
- **`recovery`** — collects the last `RECOVERY_TRAIL_LIMIT` (currently 12)
  messages for the agent, enough to capture the error and the fix.
- **`goal_achieved`** — collects the goal record, its associated issues, and
  their artifacts.
- **`approval_rejected`** — collects the approval record and its payload.

Source: `apps/main/src/derivation/trail.ts`.

---

## Headless runner

`apps/main/src/derivation/runner.ts` spawns `claude` in print mode:

```
claude -p --model claude-sonnet-4-6 --output-format stream-json --verbose --strict-mcp-config
```

The prompt is written to stdin. `--strict-mcp-config` with no `--mcp-config`
means zero MCP servers — the derivation run needs no tools and gets no access
to the database or filesystem. The runner reads the `result` event from the
stream-json transcript to extract the text and token usage.

---

## Worker pipeline

For each job, in order:

1. Check daily cap; drop if exhausted.
2. Build trail from database.
3. Build derivation prompt (wraps trail in structured instructions).
4. Run headless `claude -p`; collect text and token usage.
5. Write a `cost_event` row (`adapter_name = 'derivation'`). This happens
   before parsing — if the parse fails the cost is still recorded.
6. Parse the LLM output.
7. Run `sanitizeMemoryBody` on each parsed field.
8. Write the output (skill candidate or memory row).

Source: `apps/main/src/derivation/worker.ts`.

---

## Review gating

The two triggers that produce skill candidates (`issue_done`, `recovery`)
require human review:

- The worker writes a `skill_candidates` row and an inbox item of kind
  `skill_candidate_pending`.
- The user can Accept, Edit then accept, or Reject the candidate from the
  Learning tab.
- On Accept, `apps/main/src/memory/review-candidate.ts` creates a `skills`
  row and the `SKILL.md` body file.

The two triggers that produce memory rows (`goal_achieved`, `approval_rejected`)
write directly to the `memories` table after sanitization — no human review
step. These entries are treated as objective facts derived from structured
events, not user-authored procedures.

---

## Nudge fallback

When the pipeline has been quiet, a per-session in-process counter
(`apps/main/src/orchestrator/nudge.ts`) reminds the agent to persist learnings.
Two thresholds, checked after each completed turn:

- **Work volume**: 30 turns or 25 cumulative tool calls since the last nudge.
  The orchestrator prepends `NUDGE_SKILL_HINT` to the agent's next turn.
- **Memory pressure**: the agent's rendered declarative memory exceeds 90% of
  its 1 024-character system-prompt cap. The orchestrator prepends
  `NUDGE_CONSOLIDATION_HINT` once per session.

The memory-pressure hint takes priority when both conditions are true. The
work-volume counters reset after each nudge fires. Counters are per-agent and
cleared on session init (fresh `claude` process).

**Known gap:** the Hermes research doc (§4) also described a compaction-event
nudge trigger — firing when the context is compacted. There is no compaction
event in this app, so that trigger is not implemented.
