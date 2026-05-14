import type Database from "better-sqlite3";

export type CompanyExportV1 = {
  schemaVersion: 1;
  exportedAt: number;
  company: { id: string; name: string; createdAt: number };
  agents: unknown[];
  projects: unknown[];
  issues: unknown[];
  threads: unknown[];
  messages: unknown[];
  inbox: unknown[];
  costEvents: unknown[];
  activityEvents: unknown[];
  goals: unknown[];
  approvals: unknown[];
};

// Best-effort row collect: try/catch per table so a missing column in one table
// doesn't kill the whole export. Returns [] on any SQL error.
const safeCollect = (
  db: Database.Database,
  sql: string,
  params: Record<string, unknown>,
): unknown[] => {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
};

export const exportCompany = (db: Database.Database, companyId: string): CompanyExportV1 => {
  const companyRow = db
    .prepare("SELECT id, name, created_at FROM companies WHERE id = ?")
    .get(companyId) as { id: string; name: string; created_at: number } | undefined;
  if (companyRow === undefined) {
    throw new Error(`Company ${companyId} not found`);
  }

  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    company: { id: companyRow.id, name: companyRow.name, createdAt: companyRow.created_at },
    agents: safeCollect(db, "SELECT * FROM agents WHERE company_id = @cid", { cid: companyId }),
    projects: safeCollect(db, "SELECT * FROM projects WHERE company_id = @cid", {
      cid: companyId,
    }),
    issues: safeCollect(db, "SELECT * FROM issues WHERE company_id = @cid", { cid: companyId }),
    threads: safeCollect(db, "SELECT * FROM threads WHERE company_id = @cid", {
      cid: companyId,
    }),
    messages: safeCollect(
      db,
      "SELECT m.* FROM messages m JOIN threads t ON m.thread_id = t.id WHERE t.company_id = @cid",
      { cid: companyId },
    ),
    inbox: safeCollect(db, "SELECT * FROM inbox_items WHERE company_id = @cid", {
      cid: companyId,
    }),
    costEvents: safeCollect(db, "SELECT * FROM cost_events WHERE company_id = @cid", {
      cid: companyId,
    }),
    activityEvents: safeCollect(db, "SELECT * FROM activity_events WHERE company_id = @cid", {
      cid: companyId,
    }),
    goals: safeCollect(db, "SELECT * FROM goals WHERE company_id = @cid", { cid: companyId }),
    approvals: safeCollect(
      db,
      "SELECT a.* FROM approvals a JOIN agents ag ON a.agent_id = ag.id WHERE ag.company_id = @cid",
      { cid: companyId },
    ),
  };
};
