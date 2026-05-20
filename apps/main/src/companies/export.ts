import { existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { companyTelosPath } from "./telos-dir.js";
import { goalIsaPath } from "../goals/isa-dir.js";

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
  // M13 PR-F Task 2: opt-in disk-backed artifacts (telos.md + per-goal isa.md).
  // Files live under <userData>/companies/<cid>/{telos.md,goals/<gid>/isa.md},
  // so the JSON snapshot alone would otherwise lose them. Absent fields mean
  // no file existed on disk at export time.
  artifacts?: {
    companyTelos?: string;
    goalIsas?: Record<string, string>;
  };
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

// Reads a file under userData if it exists, returning its body or null. Defensive:
// any IO error (permissions, transient FS) yields null so a single missing artifact
// never kills the whole export — consistent with safeCollect above. An empty file
// body is treated as "no artifact" so the round-trip matches the import side,
// which skips empty bodies to avoid stamping a path for a vacuous file.
const safeRead = (path: string): string | null => {
  try {
    if (!existsSync(path)) return null;
    const body = readFileSync(path, "utf8");
    return body.length > 0 ? body : null;
  } catch {
    return null;
  }
};

export const exportCompany = (
  db: Database.Database,
  companyId: string,
  userDataDir?: string,
): CompanyExportV1 => {
  const companyRow = db
    .prepare("SELECT id, name, created_at FROM companies WHERE id = ?")
    .get(companyId) as { id: string; name: string; created_at: number } | undefined;
  if (companyRow === undefined) {
    throw new Error(`Company ${companyId} not found`);
  }

  const result: CompanyExportV1 = {
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

  // M13 PR-F Task 2: when a userData dir is provided, snapshot the on-disk
  // artifacts (telos.md, per-goal isa.md). Older call sites that don't pass
  // userDataDir get the legacy shape — artifacts simply stays undefined.
  // Path helpers reject unsafe ids by throwing; we catch so an unexpectedly
  // shaped id in one row can never abort the whole export.
  if (userDataDir !== undefined) {
    let companyTelos: string | null = null;
    try {
      companyTelos = safeRead(companyTelosPath(userDataDir, companyId));
    } catch {
      companyTelos = null;
    }
    const goalRows = result.goals as Array<{ id: string }>;
    const goalIsas: Record<string, string> = {};
    for (const g of goalRows) {
      if (typeof g.id !== "string" || g.id.length === 0) continue;
      try {
        const body = safeRead(goalIsaPath(userDataDir, companyId, g.id));
        if (body !== null) goalIsas[g.id] = body;
      } catch {
        // unsafe goal id segment — skip silently, mirrors safeCollect's stance
      }
    }
    const hasIsas = Object.keys(goalIsas).length > 0;
    if (companyTelos !== null || hasIsas) {
      result.artifacts = {
        ...(companyTelos !== null ? { companyTelos } : {}),
        ...(hasIsas ? { goalIsas } : {}),
      };
    }
  }

  return result;
};
