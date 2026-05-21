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
  // Non-empty only when one or more tables failed to collect (e.g. schema
  // drift). Surfaces a partial backup instead of masking it as a clean one.
  warnings?: string[];
};

// Best-effort row collect: try/catch per table so a missing column in one table
// doesn't kill the whole export. Returns [] on error AND records a warning so a
// partial backup is visible instead of silently incomplete (relatorioCodex P2).
const safeCollect = (
  db: Database.Database,
  table: string,
  sql: string,
  params: Record<string, unknown>,
  warnings: string[],
): unknown[] => {
  try {
    return db.prepare(sql).all(params);
  } catch (e) {
    warnings.push(`${table}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
};

// Reads a file under userData if it exists, returning its body or null. Defensive:
// any IO error (permissions, transient FS) yields null so a single missing artifact
// never kills the whole export — consistent with safeCollect above. An empty file
// body is treated as "no artifact" so the round-trip matches the import side,
// which skips empty bodies to avoid stamping a path for a vacuous file.
const safeRead = (path: string, onError?: (err: unknown) => void): string | null => {
  try {
    if (!existsSync(path)) return null;
    const body = readFileSync(path, "utf8");
    return body.length > 0 ? body : null;
  } catch (e) {
    // A missing file returns null above; reaching here means the file exists but
    // could not be read (e.g. permissions). Report it so the artifact isn't
    // silently dropped from an otherwise "clean" export (relatorioClaudinho P3-E).
    onError?.(e);
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

  const warnings: string[] = [];
  const result: CompanyExportV1 = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    company: { id: companyRow.id, name: companyRow.name, createdAt: companyRow.created_at },
    agents: safeCollect(
      db,
      "agents",
      "SELECT * FROM agents WHERE company_id = @cid",
      {
        cid: companyId,
      },
      warnings,
    ),
    projects: safeCollect(
      db,
      "projects",
      "SELECT * FROM projects WHERE company_id = @cid",
      {
        cid: companyId,
      },
      warnings,
    ),
    issues: safeCollect(
      db,
      "issues",
      "SELECT * FROM issues WHERE company_id = @cid",
      {
        cid: companyId,
      },
      warnings,
    ),
    threads: safeCollect(
      db,
      "threads",
      "SELECT * FROM threads WHERE company_id = @cid",
      {
        cid: companyId,
      },
      warnings,
    ),
    messages: safeCollect(
      db,
      "messages",
      "SELECT m.* FROM messages m JOIN threads t ON m.thread_id = t.id WHERE t.company_id = @cid",
      { cid: companyId },
      warnings,
    ),
    inbox: safeCollect(
      db,
      "inbox",
      "SELECT * FROM inbox_items WHERE company_id = @cid",
      {
        cid: companyId,
      },
      warnings,
    ),
    costEvents: safeCollect(
      db,
      "costEvents",
      "SELECT * FROM cost_events WHERE company_id = @cid",
      {
        cid: companyId,
      },
      warnings,
    ),
    activityEvents: safeCollect(
      db,
      "activityEvents",
      "SELECT * FROM activity_events WHERE company_id = @cid",
      { cid: companyId },
      warnings,
    ),
    goals: safeCollect(
      db,
      "goals",
      "SELECT * FROM goals WHERE company_id = @cid",
      {
        cid: companyId,
      },
      warnings,
    ),
    approvals: safeCollect(
      db,
      "approvals",
      "SELECT a.* FROM approvals a JOIN agents ag ON a.agent_id = ag.id WHERE ag.company_id = @cid",
      { cid: companyId },
      warnings,
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
      companyTelos = safeRead(companyTelosPath(userDataDir, companyId), (e) =>
        warnings.push(`telos.md: ${e instanceof Error ? e.message : String(e)}`),
      );
    } catch {
      companyTelos = null;
    }
    const goalRows = result.goals as Array<{ id: string }>;
    const goalIsas: Record<string, string> = {};
    for (const g of goalRows) {
      if (typeof g.id !== "string" || g.id.length === 0) continue;
      try {
        const body = safeRead(goalIsaPath(userDataDir, companyId, g.id), (e) =>
          warnings.push(`isa.md (goal ${g.id}): ${e instanceof Error ? e.message : String(e)}`),
        );
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

  if (warnings.length > 0) result.warnings = warnings;
  return result;
};
