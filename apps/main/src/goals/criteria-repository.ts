import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  CreateCriterionInput,
  CriterionCheckSpec,
  CriterionCheckType,
  CriterionKind,
  CriterionResult,
  CriterionStatus,
  GoalCriterion,
  UpdateCriterionInput,
} from "@prospero/shared";

export type GoalCriteriaRepository = {
  create(input: CreateCriterionInput): GoalCriterion;
  getById(id: string): GoalCriterion | null;
  listByGoal(goalId: string): GoalCriterion[];
  update(id: string, input: UpdateCriterionInput): GoalCriterion;
  delete(id: string): void;
  // Persists a deterministic check result. `detail` on the CriterionResult is
  // not stored as its own column — it is derivable from last_result_json.
  applyResult(result: CriterionResult): void;
  setJudgment(id: string, status: CriterionStatus, verifiedBy: string | null): void;
};

type CriterionRow = {
  id: string;
  goal_id: string;
  sort_order: number;
  statement: string;
  kind: string;
  check_type: string | null;
  check_spec: string | null;
  status: string;
  last_checked_at: number | null;
  last_result_json: string | null;
  verified_by: string | null;
  attempts: number;
  created_at: number;
  updated_at: number;
};

// Defensive parse: check_spec is zod-validated at write time, but a malformed
// value from a migration or test fixture must not crash a read path.
const parseCheckSpec = (raw: string | null): CriterionCheckSpec | null => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as CriterionCheckSpec;
  } catch {
    return null;
  }
};

const rowToCriterion = (row: CriterionRow): GoalCriterion => ({
  id: row.id,
  goalId: row.goal_id,
  sortOrder: row.sort_order,
  statement: row.statement,
  kind: row.kind as CriterionKind,
  checkType: row.check_type as CriterionCheckType | null,
  checkSpec: parseCheckSpec(row.check_spec),
  status: row.status as CriterionStatus,
  lastCheckedAt: row.last_checked_at,
  lastResultJson: row.last_result_json,
  verifiedBy: row.verified_by,
  attempts: row.attempts,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const createGoalCriteriaRepository = (db: Database.Database): GoalCriteriaRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO goal_criteria (
      id, goal_id, sort_order, statement, kind, check_type, check_spec,
      status, created_at, updated_at
    ) VALUES (
      @id, @goalId, @sortOrder, @statement, @kind, @checkType, @checkSpec,
      'pending', @createdAt, @updatedAt
    )
  `);
  const nextSortStmt = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM goal_criteria WHERE goal_id = ?",
  );
  const getByIdStmt = db.prepare("SELECT * FROM goal_criteria WHERE id = ?");
  const listStmt = db.prepare(
    "SELECT * FROM goal_criteria WHERE goal_id = ? ORDER BY sort_order ASC",
  );
  const updateStmt = db.prepare(`
    UPDATE goal_criteria SET
      statement = @statement, kind = @kind, check_type = @checkType,
      check_spec = @checkSpec, updated_at = @updatedAt
    WHERE id = @id
  `);
  const deleteStmt = db.prepare("DELETE FROM goal_criteria WHERE id = ?");
  const applyResultStmt = db.prepare(`
    UPDATE goal_criteria SET
      status = @status, last_checked_at = @checkedAt,
      last_result_json = @resultJson, updated_at = @updatedAt,
      attempts = attempts + 1
    WHERE id = @id
  `);
  const setJudgmentStmt = db.prepare(`
    UPDATE goal_criteria SET
      status = @status, verified_by = @verifiedBy,
      last_checked_at = @checkedAt, updated_at = @updatedAt
    WHERE id = @id
  `);

  const getById = (id: string): GoalCriterion | null => {
    const row = getByIdStmt.get(id) as CriterionRow | undefined;
    return row !== undefined ? rowToCriterion(row) : null;
  };

  const create = (input: CreateCriterionInput): GoalCriterion => {
    const id = `crit_${randomUUID()}`;
    const now = Date.now();
    const sortOrder = (nextSortStmt.get(input.goalId) as { n: number }).n;
    // C7b (audit 2026-06-03): enforce the type invariant — a deterministic
    // criterion REQUIRES a checkSpec, else checkDeterministic returns
    // "no check spec" and the criterion fails verification forever. Accepting an
    // AI-proposed ISA carries a checkType HINT but no spec; persist those (and
    // any spec-less criterion) as JUDGMENT so a human verifies them instead of
    // them silently failing. Both fields are null together for judgment.
    const hasSpec = input.checkSpec != null;
    const kind = hasSpec ? input.kind : "judgment";
    const checkType = hasSpec ? (input.checkType ?? null) : null;
    const checkSpec = hasSpec ? JSON.stringify(input.checkSpec) : null;
    insertStmt.run({
      id,
      goalId: input.goalId,
      sortOrder,
      statement: input.statement,
      kind,
      checkType,
      checkSpec,
      createdAt: now,
      updatedAt: now,
    });
    return rowToCriterion({
      id,
      goal_id: input.goalId,
      sort_order: sortOrder,
      statement: input.statement,
      kind,
      check_type: checkType,
      check_spec: checkSpec,
      status: "pending",
      last_checked_at: null,
      last_result_json: null,
      verified_by: null,
      attempts: 0,
      created_at: now,
      updated_at: now,
    });
  };

  const applyResult: GoalCriteriaRepository["applyResult"] = (result) => {
    const now = Date.now();
    // Persist the human-readable `detail` ALONGSIDE the structured resultJson so
    // it is recoverable from last_result_json (the only consumer is the LEARN
    // failure trail, which reads `.detail`). Without this the structured shape
    // ({exitCode,stdout,stderr,...}) has no `detail` key and the failure lesson
    // is blind to the actual error. Audit 2026-06-03 Facet 5 M3.
    const base =
      result.resultJson !== null && typeof result.resultJson === "object"
        ? (result.resultJson as Record<string, unknown>)
        : {};
    applyResultStmt.run({
      id: result.criterionId,
      status: result.status,
      checkedAt: now,
      resultJson: JSON.stringify({ ...base, detail: result.detail }),
      updatedAt: now,
    });
  };

  const setJudgment: GoalCriteriaRepository["setJudgment"] = (id, status, verifiedBy) => {
    const now = Date.now();
    setJudgmentStmt.run({ id, status, verifiedBy, checkedAt: now, updatedAt: now });
  };

  const update = (id: string, input: UpdateCriterionInput): GoalCriterion => {
    // checkType/checkSpec may be null here — better-sqlite3 maps JS null to SQL
    // NULL, which correctly clears the columns for a judgment criterion.
    updateStmt.run({
      id,
      statement: input.statement,
      kind: input.kind,
      checkType: input.checkType,
      checkSpec: input.checkSpec != null ? JSON.stringify(input.checkSpec) : null,
      updatedAt: Date.now(),
    });
    const updated = getById(id);
    if (updated === null) throw new Error(`criterion not found: ${id}`);
    return updated;
  };

  return {
    create,
    getById,
    listByGoal: (goalId) => (listStmt.all(goalId) as CriterionRow[]).map(rowToCriterion),
    update,
    delete: (id) => {
      deleteStmt.run(id);
    },
    applyResult,
    setJudgment,
  };
};
