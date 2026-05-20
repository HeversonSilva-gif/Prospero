import type Database from "better-sqlite3";
import type { Briefing, BriefingItem } from "@prospero/shared";

// M14 PR-C — Morning Briefing read-model. Pure SQL JOINs on existing tables
// (no new state besides the cursor on `companies`). Headline is built
// separately by `headline.ts` and stitched in by the IPC handler.
//
// Window semantics: when sinceTs is null, the default 24h window is used.
// When non-null, items strictly after sinceTs land in the buckets.

export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREVIEW_MAX = 200;

const NEEDS_YOU_KINDS = [
  "approval",
  "verification_failed",
  "verification_review",
  "trust_promotion_suggested",
  "agent_unresponsive",
  "goal_error",
  "budget_warning",
];

const truncate = (s: string | null): string => {
  if (s === null) return "";
  return s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX - 1)}…` : s;
};

const inboxRoute = (kind: string, payloadJson: string | null): string => {
  if (
    kind === "goal_proposed" ||
    kind === "goal_executing" ||
    kind === "goal_error" ||
    kind === "goal_retrospective_ready" ||
    kind === "verification_failed" ||
    kind === "verification_review"
  ) {
    if (payloadJson === null) return "/inbox";
    try {
      const parsed = JSON.parse(payloadJson) as { goalId?: unknown };
      if (typeof parsed.goalId === "string") return `/goals/${parsed.goalId}`;
    } catch {
      /* fall through */
    }
  }
  return "/inbox";
};

export const buildBriefing = (
  db: Database.Database,
  companyId: string,
  sinceTs: number | null,
  now: number,
): Briefing => {
  const since = sinceTs ?? now - DEFAULT_WINDOW_MS;

  // 1. needsYou — pending inbox items in the action-required kinds.
  const inboxRows = db
    .prepare(
      `SELECT i.id, i.kind, i.title, i.preview, i.payload_json AS payload_json, i.actor_id, a.name AS agent_name
         FROM inbox_items i
         LEFT JOIN agents a ON a.id = i.actor_id
        WHERE i.company_id = ?
          AND i.read_at IS NULL
          AND i.requires_action = 1
          AND i.kind IN (${NEEDS_YOU_KINDS.map(() => "?").join(",")})
        ORDER BY i.created_at DESC`,
    )
    .all(companyId, ...NEEDS_YOU_KINDS) as Array<{
    id: string;
    kind: string;
    title: string;
    preview: string | null;
    payload_json: string | null;
    actor_id: string | null;
    agent_name: string | null;
  }>;
  const needsYou: BriefingItem[] = inboxRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: truncate(r.preview),
    route: inboxRoute(r.kind, r.payload_json),
    agentName: r.agent_name,
  }));

  // 2. verified — goals achieved since the cursor.
  const verifiedRows = db
    .prepare(
      `SELECT g.id, g.title, g.updated_at, a.name AS agent_name
         FROM goals g
         LEFT JOIN agents a ON a.id = g.owner_agent_id
        WHERE g.company_id = ?
          AND g.status = 'achieved'
          AND g.updated_at > ?
        ORDER BY g.updated_at DESC`,
    )
    .all(companyId, since) as Array<{
    id: string;
    title: string;
    updated_at: number;
    agent_name: string | null;
  }>;
  const verified: BriefingItem[] = verifiedRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: r.agent_name !== null ? `Owned by ${r.agent_name}` : "Goal closed",
    route: `/goals/${r.id}`,
    agentName: r.agent_name,
  }));

  // 3. failed — verification_failed + goal_error inbox since the cursor.
  const failedRows = db
    .prepare(
      `SELECT i.id, i.title, i.preview, i.payload_json, i.kind, a.name AS agent_name
         FROM inbox_items i
         LEFT JOIN agents a ON a.id = i.actor_id
        WHERE i.company_id = ?
          AND i.kind IN ('verification_failed','goal_error')
          AND i.created_at > ?
        ORDER BY i.created_at DESC`,
    )
    .all(companyId, since) as Array<{
    id: string;
    title: string;
    preview: string | null;
    payload_json: string | null;
    kind: string;
    agent_name: string | null;
  }>;
  const failed: BriefingItem[] = failedRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: truncate(r.preview),
    route: inboxRoute(r.kind, r.payload_json),
    agentName: r.agent_name,
  }));

  // 4. inProgress — issues in 'doing'/'review' right now.
  const inProgressRows = db
    .prepare(
      `SELECT i.id, i.title, i.status, a.name AS agent_name
         FROM issues i
         LEFT JOIN agents a ON a.id = i.assignee_id
        WHERE i.company_id = ?
          AND i.status IN ('doing','review')
        ORDER BY i.updated_at DESC`,
    )
    .all(companyId) as Array<{
    id: string;
    title: string;
    status: string;
    agent_name: string | null;
  }>;
  const inProgress: BriefingItem[] = inProgressRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: r.status === "review" ? "In review" : "Doing",
    route: "/issues",
    agentName: r.agent_name,
  }));

  // 5. learned — skill_candidate_pending inbox since cursor.
  const learnedRows = db
    .prepare(
      `SELECT i.id, i.title, i.preview, a.name AS agent_name
         FROM inbox_items i
         LEFT JOIN agents a ON a.id = i.actor_id
        WHERE i.company_id = ?
          AND i.kind = 'skill_candidate_pending'
          AND i.created_at > ?
        ORDER BY i.created_at DESC`,
    )
    .all(companyId, since) as Array<{
    id: string;
    title: string;
    preview: string | null;
    agent_name: string | null;
  }>;
  const learned: BriefingItem[] = learnedRows.map((r) => ({
    id: r.id,
    label: r.title,
    detail: truncate(r.preview),
    route: "/inbox",
    agentName: r.agent_name,
  }));

  // 6. costCents — sum of cost_events since the cursor.
  const costRow = db
    .prepare(
      `SELECT COALESCE(SUM(cost_cents_estimate), 0) AS sum
         FROM cost_events
        WHERE company_id = ?
          AND occurred_at > ?`,
    )
    .get(companyId, since) as { sum: number };
  const costCents = costRow.sum;

  // 7. reviewedAt — read the cursor from the companies row.
  const cursorRow = db
    .prepare("SELECT briefing_reviewed_at AS reviewed_at FROM companies WHERE id = ?")
    .get(companyId) as { reviewed_at: number | null } | undefined;
  const reviewedAt = cursorRow?.reviewed_at ?? null;

  return {
    headline: "",
    needsYou,
    verified,
    failed,
    inProgress,
    learned,
    costCents,
    generatedAt: now,
    reviewedAt,
  };
};
