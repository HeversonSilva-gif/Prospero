import type Database from "better-sqlite3";

// Recalls the OWNER's recent decisions from the existing approvals table (no new capture).
// Only `decided_by = 'user'` rows count — CEO ('ceo') decisions are the AI's, not the owner's.
// Rejections-with-notes are the signal (revealed preferences). Joined to agents for company scope.

export type OwnerDecision = {
  tool: string;
  status: "approved" | "rejected";
  note: string | null;
  at: number;
};

export const recentOwnerDecisions = (
  db: Database.Database,
  companyId: string,
  limit: number,
): OwnerDecision[] => {
  const rows = db
    .prepare(
      `SELECT ap.kind, ap.payload_json, ap.status, ap.decision_note, ap.resolved_at
         FROM approvals ap JOIN agents ag ON ag.id = ap.agent_id
        WHERE ag.company_id = ? AND ap.decided_by = 'user'
          AND ap.status IN ('approved','rejected')
        ORDER BY ap.resolved_at DESC LIMIT ?`,
    )
    .all(companyId, limit) as Array<{
    kind: string;
    payload_json: string;
    status: string;
    decision_note: string | null;
    resolved_at: number | null;
  }>;
  return rows.map((r) => {
    let tool = r.kind;
    try {
      const p = JSON.parse(r.payload_json) as { tool_name?: unknown };
      if (typeof p.tool_name === "string") tool = p.tool_name;
    } catch {
      /* keep the kind */
    }
    return {
      tool,
      status: r.status as "approved" | "rejected",
      note: r.decision_note,
      at: r.resolved_at ?? 0,
    };
  });
};
