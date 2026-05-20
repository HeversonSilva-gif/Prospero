import type Database from "better-sqlite3";

// The trail handed to the LEARN prompt when a goal's verification fails. We
// surface the goal context and the specific criteria the dispatcher told us
// failed, including each criterion's attempts count and the last result detail
// (truncated, so a prompt-injection attempt in stdout can't blow up the prompt).

export type VerificationFailedTrail = {
  goalId: string;
  goalTitle: string;
  goalDescription: string;
  failed: Array<{
    statement: string;
    kind: "deterministic" | "judgment";
    attempts: number;
    lastDetail: string;
  }>;
};

const MAX_DETAIL_CHARS = 1000;

const extractDetail = (resultJson: string | null): string => {
  if (resultJson === null) return "";
  try {
    const parsed = JSON.parse(resultJson) as { detail?: unknown };
    const d = typeof parsed.detail === "string" ? parsed.detail : "";
    return d.slice(0, MAX_DETAIL_CHARS);
  } catch {
    return "";
  }
};

export const buildVerificationFailedTrail = (
  db: Database.Database,
  goalId: string,
  failedCriterionIds: string[],
): VerificationFailedTrail | null => {
  const goal = db.prepare("SELECT id, title, description FROM goals WHERE id = ?").get(goalId) as
    | { id: string; title: string; description: string | null }
    | undefined;
  if (goal === undefined) return null;

  if (failedCriterionIds.length === 0) {
    return {
      goalId: goal.id,
      goalTitle: goal.title,
      goalDescription: goal.description ?? "",
      failed: [],
    };
  }

  const placeholders = failedCriterionIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT statement, kind, attempts, last_result_json
       FROM goal_criteria
       WHERE goal_id = ? AND id IN (${placeholders})
       ORDER BY sort_order`,
    )
    .all(goalId, ...failedCriterionIds) as Array<{
    statement: string;
    kind: "deterministic" | "judgment";
    attempts: number;
    last_result_json: string | null;
  }>;

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    goalDescription: goal.description ?? "",
    failed: rows.map((r) => ({
      statement: r.statement,
      kind: r.kind,
      attempts: r.attempts,
      lastDetail: extractDetail(r.last_result_json),
    })),
  };
};
