import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  CreateCriterionInput,
  CriterionCheckSpec,
  CriterionCheckType,
  CriterionKind,
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
  created_at: number;
  updated_at: number;
};

const rowToCriterion = (row: CriterionRow): GoalCriterion => ({
  id: row.id,
  goalId: row.goal_id,
  sortOrder: row.sort_order,
  statement: row.statement,
  kind: row.kind as CriterionKind,
  checkType: row.check_type as CriterionCheckType | null,
  checkSpec: row.check_spec !== null ? (JSON.parse(row.check_spec) as CriterionCheckSpec) : null,
  status: row.status as CriterionStatus,
  lastCheckedAt: row.last_checked_at,
  lastResultJson: row.last_result_json,
  verifiedBy: row.verified_by,
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

  const getById = (id: string): GoalCriterion | null => {
    const row = getByIdStmt.get(id) as CriterionRow | undefined;
    return row !== undefined ? rowToCriterion(row) : null;
  };

  const create = (input: CreateCriterionInput): GoalCriterion => {
    const id = `crit_${randomUUID()}`;
    const now = Date.now();
    const sortOrder = (nextSortStmt.get(input.goalId) as { n: number }).n;
    insertStmt.run({
      id,
      goalId: input.goalId,
      sortOrder,
      statement: input.statement,
      kind: input.kind,
      checkType: input.checkType ?? null,
      checkSpec: input.checkSpec != null ? JSON.stringify(input.checkSpec) : null,
      createdAt: now,
      updatedAt: now,
    });
    return getById(id)!;
  };

  const update = (id: string, input: UpdateCriterionInput): GoalCriterion => {
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
  };
};
