import type Database from "better-sqlite3";

// Sliding-window runaway circuit-breaker. Counts side-effecting tool-call attempts
// that PASSED the cap (each inserts an `approvals` row) in the trailing hour, per
// agent+tool, plus a per-company aggregate ceiling. Read/unknown tools are never
// capped. Pre-checked inside gateAction BEFORE the approval row is created.

export const WINDOW_MS = 60 * 60 * 1000;

// Per-agent, per-tool hourly limits. Tools absent here are not side-effecting → uncapped.
export const SIDE_EFFECTING_LIMITS: Record<string, number> = {
  post_to_x: 5,
  reply_on_x: 5,
  send_email: 10,
  setup_monetization: 2,
  create_payment_link: 2,
  deploy_app: 1,
};

// Aggregate ceiling: total side-effecting actions across all of a company's agents/hour.
export const COMPANY_HOURLY_CEILING = 30;

export interface ActionCapInput {
  companyId: string;
  agentId: string;
  toolName: string;
  now: number;
}

export interface ActionCapResult {
  exceeded: boolean;
  limit: number;
  count: number;
  scope: "tool" | "company" | "none";
}

const likeFor = (toolName: string): string => `%"tool_name":"${toolName}"%`;

export const checkActionCap = (db: Database.Database, input: ActionCapInput): ActionCapResult => {
  try {
    const limit = SIDE_EFFECTING_LIMITS[input.toolName];
    if (limit === undefined) return { exceeded: false, limit: 0, count: 0, scope: "none" };
    const cutoff = input.now - WINDOW_MS;

    const toolRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM approvals
         WHERE agent_id = ? AND kind = 'tool_call' AND created_at > ? AND payload_json LIKE ?`,
      )
      .get(input.agentId, cutoff, likeFor(input.toolName)) as { cnt: number };
    if (toolRow.cnt >= limit) {
      return { exceeded: true, limit, count: toolRow.cnt, scope: "tool" };
    }

    // Company-wide ceiling across all side-effecting tools.
    const likeClauses = Object.keys(SIDE_EFFECTING_LIMITS).map(() => "ap.payload_json LIKE ?");
    const companyRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM approvals ap
           JOIN agents ag ON ag.id = ap.agent_id
          WHERE ag.company_id = ? AND ap.kind = 'tool_call' AND ap.created_at > ?
            AND (${likeClauses.join(" OR ")})`,
      )
      .get(input.companyId, cutoff, ...Object.keys(SIDE_EFFECTING_LIMITS).map(likeFor)) as {
      cnt: number;
    };
    if (companyRow.cnt >= COMPANY_HOURLY_CEILING) {
      return {
        exceeded: true,
        limit: COMPANY_HOURLY_CEILING,
        count: companyRow.cnt,
        scope: "company",
      };
    }

    return { exceeded: false, limit, count: toolRow.cnt, scope: "tool" };
  } catch (err) {
    // Fail-open: a query error must not block all actions (the approval gate still gates).
    console.warn("[guardrails] checkActionCap failed", err);
    return { exceeded: false, limit: 0, count: 0, scope: "none" };
  }
};
