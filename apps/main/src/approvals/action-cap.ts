import type Database from "better-sqlite3";

export const WINDOW_MS = 60 * 60 * 1000;

// Per-agent, per-tool hourly limits. Tools absent here are not side-effecting → uncapped.
export const SIDE_EFFECTING_LIMITS: Record<string, number> = {
  post_to_x: 5,
  reply_on_x: 5,
  send_email: 10,
  setup_monetization: 2,
  create_payment_link: 2,
  deploy_app: 1,
  // Conectores M2 (review): preview deploys get their OWN hourly cap so they're bounded
  // without consuming the 1/h production slot — otherwise the normal "preview to test,
  // then promote to production" flow blocks at the second step.
  deploy_app_preview: 5,
  // Audit 2026-06-03 Conectores I2: each provision creates a fresh Cloudflare D1
  // (cost/quota) — deploy_app was capped but this sibling wasn't. Match deploy's 1/h.
  provision_database: 1,
};

// Hard ceiling on TOTAL side-effecting actions across all of a company's agents per
// hour — a backstop above the per-agent caps (many agents each just under their own
// limit could still flood). ~one side-effecting action every 2 minutes company-wide.
export const COMPANY_HOURLY_CEILING = 30;

const SIDE_EFFECTING_TOOLS = Object.keys(SIDE_EFFECTING_LIMITS);

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

type Stmt = Database.Statement;
interface CapStatements {
  tool: Stmt;
  company: Stmt;
}

// gateAction pre-checks this on EVERY side-effecting call — cache the prepared
// statements per db (both SQL strings are static) instead of re-compiling each call.
const cache = new WeakMap<Database.Database, CapStatements>();
const stmtsFor = (db: Database.Database): CapStatements => {
  let s = cache.get(db);
  if (s === undefined) {
    const placeholders = SIDE_EFFECTING_TOOLS.map(() => "?").join(", ");
    s = {
      tool: db.prepare(
        `SELECT COUNT(*) AS cnt FROM approvals
         WHERE agent_id = ? AND kind = 'tool_call' AND created_at > ?
           AND json_extract(payload_json, '$.tool_name') = ?`,
      ),
      company: db.prepare(
        `SELECT COUNT(*) AS cnt FROM approvals ap
           JOIN agents ag ON ag.id = ap.agent_id
          WHERE ag.company_id = ? AND ap.kind = 'tool_call' AND ap.created_at > ?
            AND json_extract(ap.payload_json, '$.tool_name') IN (${placeholders})`,
      ),
    };
    cache.set(db, s);
  }
  return s;
};

export const checkActionCap = (db: Database.Database, input: ActionCapInput): ActionCapResult => {
  try {
    const limit = SIDE_EFFECTING_LIMITS[input.toolName];
    if (limit === undefined) return { exceeded: false, limit: 0, count: 0, scope: "none" };
    const cutoff = input.now - WINDOW_MS;
    const stmts = stmtsFor(db);

    const toolRow = stmts.tool.get(input.agentId, cutoff, input.toolName) as { cnt: number };
    if (toolRow.cnt >= limit) return { exceeded: true, limit, count: toolRow.cnt, scope: "tool" };

    const companyRow = stmts.company.get(input.companyId, cutoff, ...SIDE_EFFECTING_TOOLS) as {
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
