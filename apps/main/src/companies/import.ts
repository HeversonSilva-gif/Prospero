import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  CompanyImportSchemaV1,
  type CompanyImportV1,
  type ImportSummary,
} from "./import-schema.js";
import { companyTelosPath, relativeTelosPath } from "./telos-dir.js";
import { goalIsaPath, relativeIsaPath } from "../goals/isa-dir.js";
import { createCompaniesRepository } from "./repository.js";
import { createGoalsRepository } from "../goals/repository.js";

// PR-F.2.1: restores a company exported by exportCompany (PR-F.1).
// Strategy:
//  - Validate payload shape via zod.
//  - Pre-pass collects old IDs per entity → maps to fresh UUIDs.
//  - INSERT each table in topological order with FK columns substituted.
//  - Reflexive FKs (reports_to, parent_id, parent_goal_id, goal_id) are
//    nulled initially and patched via UPDATE pass at the end.
//  - Per-row intersection with PRAGMA table_info defends against schema drift:
//    columns the export has but the current DB lacks are silently dropped.
//  - Foreign keys are disabled for the duration of the transaction so order
//    issues never block import; orphans become NULL via missing map entries.

type IdMap = Map<string, string>;

type IdMaps = {
  companies: IdMap;
  agents: IdMap;
  projects: IdMap;
  issues: IdMap;
  threads: IdMap;
  messages: IdMap;
  inbox: IdMap;
  approvals: IdMap;
  costEvents: IdMap;
  activityEvents: IdMap;
  goals: IdMap;
};

type FkSpec = {
  table: keyof IdMaps;
  // If true, ref may equal a literal string like 'user' for messages.sender_id;
  // when value is not in target map, leave as-is.
  passthroughOnMiss?: boolean;
};

type TableImportSpec = {
  tableName: string;
  source: keyof CompanyImportV1;
  idMap: keyof IdMaps;
  // Columns whose values should be remapped via the named idMap.
  fkCols: Record<string, FkSpec>;
  // Reflexive FK columns: set to NULL on initial INSERT, patched later.
  deferredCols?: Record<string, FkSpec>;
};

const SPECS: TableImportSpec[] = [
  {
    tableName: "projects",
    source: "projects",
    idMap: "projects",
    fkCols: { company_id: { table: "companies" } },
  },
  {
    tableName: "agents",
    source: "agents",
    idMap: "agents",
    fkCols: { company_id: { table: "companies" } },
    deferredCols: { reports_to: { table: "agents" } },
  },
  {
    tableName: "threads",
    source: "threads",
    idMap: "threads",
    fkCols: { company_id: { table: "companies" } },
  },
  {
    tableName: "issues",
    source: "issues",
    idMap: "issues",
    fkCols: {
      company_id: { table: "companies" },
      project_id: { table: "projects" },
      assignee_id: { table: "agents" },
      created_by: { table: "agents" },
    },
    deferredCols: {
      parent_id: { table: "issues" },
      goal_id: { table: "goals" },
    },
  },
  {
    tableName: "messages",
    source: "messages",
    idMap: "messages",
    fkCols: {
      thread_id: { table: "threads" },
      sender_id: { table: "agents", passthroughOnMiss: true },
    },
  },
  {
    tableName: "approvals",
    source: "approvals",
    idMap: "approvals",
    fkCols: { agent_id: { table: "agents" } },
  },
  {
    tableName: "inbox_items",
    source: "inbox",
    idMap: "inbox",
    fkCols: {
      company_id: { table: "companies" },
      actor_id: { table: "agents" },
      approval_id: { table: "approvals" },
    },
  },
  {
    tableName: "cost_events",
    source: "costEvents",
    idMap: "costEvents",
    fkCols: {
      company_id: { table: "companies" },
      agent_id: { table: "agents" },
      project_id: { table: "projects" },
      issue_id: { table: "issues" },
    },
  },
  {
    tableName: "activity_events",
    source: "activityEvents",
    idMap: "activityEvents",
    fkCols: {
      company_id: { table: "companies" },
      agent_id: { table: "agents" },
    },
  },
  {
    tableName: "goals",
    source: "goals",
    idMap: "goals",
    fkCols: {
      company_id: { table: "companies" },
      owner_agent_id: { table: "agents" },
    },
    deferredCols: { parent_goal_id: { table: "goals" } },
  },
];

const tableColumns = (db: Database.Database, tableName: string): Set<string> => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
};

const remapValue = (rawValue: unknown, spec: FkSpec | undefined, maps: IdMaps): unknown => {
  if (spec === undefined) return rawValue;
  if (rawValue === null || rawValue === undefined) return rawValue;
  if (typeof rawValue !== "string") return rawValue;
  const target = maps[spec.table];
  const next = target.get(rawValue);
  if (next !== undefined) return next;
  return spec.passthroughOnMiss === true ? rawValue : null;
};

const uniqueCompanyName = (db: Database.Database, desired: string): string => {
  const exists = (n: string): boolean =>
    db.prepare("SELECT 1 FROM companies WHERE name = ? LIMIT 1").get(n) !== undefined;
  if (!exists(desired)) return desired;
  let n = 1;
  for (;;) {
    const candidate = n === 1 ? `${desired} (imported)` : `${desired} (imported ${n})`;
    if (!exists(candidate)) return candidate;
    n += 1;
  }
};

export const importCompany = (
  db: Database.Database,
  payload: unknown,
  userDataDir?: string,
): ImportSummary => {
  const parsed = CompanyImportSchemaV1.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `[company:import] invalid payload: ${parsed.error.issues[0]?.message ?? "shape mismatch"}`,
    );
  }
  const data: CompanyImportV1 = parsed.data;

  const maps: IdMaps = {
    companies: new Map(),
    agents: new Map(),
    projects: new Map(),
    issues: new Map(),
    threads: new Map(),
    messages: new Map(),
    inbox: new Map(),
    approvals: new Map(),
    costEvents: new Map(),
    activityEvents: new Map(),
    goals: new Map(),
  };

  const newCompanyId = `co_${randomUUID()}`;
  maps.companies.set(data.company.id, newCompanyId);

  // Pre-pass: register all old IDs per entity.
  const seedMap = (rows: Record<string, unknown>[], target: IdMap, prefix: string): void => {
    for (const row of rows) {
      const oldId = typeof row.id === "string" ? row.id : null;
      if (oldId === null || oldId.length === 0) continue;
      target.set(oldId, `${prefix}_${randomUUID()}`);
    }
  };
  seedMap(data.agents, maps.agents, "ag");
  seedMap(data.projects, maps.projects, "pj");
  seedMap(data.issues, maps.issues, "is");
  seedMap(data.threads, maps.threads, "th");
  seedMap(data.messages, maps.messages, "msg");
  seedMap(data.inbox, maps.inbox, "ib");
  seedMap(data.approvals, maps.approvals, "ap");
  seedMap(data.costEvents, maps.costEvents, "cev");
  seedMap(data.activityEvents, maps.activityEvents, "act");
  seedMap(data.goals, maps.goals, "gl");

  const warnings: string[] = [];
  const counts: ImportSummary["counts"] = {
    agents: 0,
    projects: 0,
    issues: 0,
    threads: 0,
    messages: 0,
    inbox: 0,
    approvals: 0,
    costEvents: 0,
    activityEvents: 0,
    goals: 0,
  };

  const newCompanyName = uniqueCompanyName(db, data.company.name);

  const wasFkOn = db.pragma("foreign_keys", { simple: true }) === 1;

  db.pragma("foreign_keys = OFF");

  const txn = db.transaction(() => {
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      newCompanyId,
      newCompanyName,
      Date.now(),
    );

    for (const spec of SPECS) {
      const rows = data[spec.source] as Record<string, unknown>[];
      const cols = tableColumns(db, spec.tableName);
      if (cols.size === 0) {
        warnings.push(
          `table ${spec.tableName} missing in current schema — skipped ${rows.length} rows`,
        );
        continue;
      }

      for (const row of rows) {
        const oldId = typeof row.id === "string" ? row.id : null;
        const newId = oldId !== null ? (maps[spec.idMap].get(oldId) ?? null) : null;
        if (newId === null) {
          warnings.push(`${spec.tableName} row without id skipped`);
          continue;
        }

        const insertCols: string[] = [];
        const insertVals: unknown[] = [];

        const deferred = spec.deferredCols ?? {};
        for (const [col, rawValue] of Object.entries(row)) {
          if (!cols.has(col)) continue; // schema drift: column doesn't exist now
          let value: unknown = rawValue;
          if (col === "id") {
            value = newId;
          } else if (col in deferred) {
            value = null;
          } else if (col in spec.fkCols) {
            value = remapValue(rawValue, spec.fkCols[col], maps);
          }
          insertCols.push(col);
          insertVals.push(value);
        }

        const placeholders = insertCols.map(() => "?").join(", ");
        const colList = insertCols.map((c) => `"${c}"`).join(", ");
        try {
          db.prepare(`INSERT INTO ${spec.tableName} (${colList}) VALUES (${placeholders})`).run(
            ...insertVals,
          );
          const countsRec = counts as Record<string, number>;
          countsRec[spec.source] = (countsRec[spec.source] ?? 0) + 1;
        } catch (err) {
          warnings.push(`${spec.tableName} row ${oldId ?? "?"} skipped: ${(err as Error).message}`);
        }
      }
    }

    // Deferred FK pass.
    for (const spec of SPECS) {
      const deferred = spec.deferredCols;
      if (deferred === undefined) continue;
      const cols = tableColumns(db, spec.tableName);
      const rows = data[spec.source] as Record<string, unknown>[];
      for (const row of rows) {
        const oldId = typeof row.id === "string" ? row.id : null;
        const newId = oldId !== null ? (maps[spec.idMap].get(oldId) ?? null) : null;
        if (newId === null) continue;
        for (const [col, fk] of Object.entries(deferred)) {
          if (!cols.has(col)) continue;
          const raw = row[col];
          const remapped = remapValue(raw, fk, maps);
          if (remapped === null || remapped === raw) continue;
          try {
            db.prepare(`UPDATE ${spec.tableName} SET "${col}" = ? WHERE id = ?`).run(
              remapped,
              newId,
            );
          } catch (err) {
            warnings.push(
              `${spec.tableName}.${col} update skipped on ${oldId ?? "?"}: ${(err as Error).message}`,
            );
          }
        }
      }
    }
  });

  try {
    txn();
  } finally {
    if (wasFkOn) {
      db.pragma("foreign_keys = ON");
    }
  }

  // M13 PR-F Task 2: surface the goal-id remap so callers can correlate restored
  // artifacts. Built from the internal map after the txn settled.
  const goalIdMap: Record<string, string> = {};
  for (const [oldId, newId] of maps.goals) {
    goalIdMap[oldId] = newId;
  }

  // M13 PR-F Task 2: restore disk-backed artifacts (telos.md, per-goal isa.md)
  // under the destination userData dir. Best-effort — per-file IO errors are
  // recorded as warnings without aborting the import. We do not touch disk when
  // the payload has no artifacts (legacy snapshots) or when userDataDir was not
  // provided (older callers, tests).
  if (userDataDir !== undefined && data.artifacts !== undefined) {
    const telosBody = data.artifacts.companyTelos;
    if (telosBody !== undefined && telosBody.length > 0) {
      try {
        const path = companyTelosPath(userDataDir, newCompanyId);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, telosBody, "utf8");
        createCompaniesRepository(db).setTelosPath(newCompanyId, relativeTelosPath(newCompanyId));
      } catch (err) {
        warnings.push(`telos.md restore skipped: ${(err as Error).message}`);
      }
    }
    const goalIsas = data.artifacts.goalIsas;
    if (goalIsas !== undefined) {
      const goalsRepo = createGoalsRepository(db);
      for (const [origGoalId, body] of Object.entries(goalIsas)) {
        const newGoalId = goalIdMap[origGoalId];
        if (newGoalId === undefined) {
          warnings.push(`isa.md for unknown goal ${origGoalId} skipped`);
          continue;
        }
        try {
          const path = goalIsaPath(userDataDir, newCompanyId, newGoalId);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, body, "utf8");
          goalsRepo.setIsaPath(newGoalId, relativeIsaPath(newCompanyId, newGoalId));
        } catch (err) {
          warnings.push(`isa.md for goal ${origGoalId} skipped: ${(err as Error).message}`);
        }
      }
    }
  }

  return {
    newCompanyId,
    newCompanyName,
    counts,
    goalIdMap,
    warnings,
  };
};
