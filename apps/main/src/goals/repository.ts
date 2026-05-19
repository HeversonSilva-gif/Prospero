import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  Goal,
  GoalLevel,
  GoalStatus,
  CreateGoalInput,
  ExecutionState,
} from "@prospero/shared";

export type GoalsListFilter = {
  status?: GoalStatus;
  parentGoalId?: string | null;
};

export type GoalsRepository = {
  create(input: CreateGoalInput): Goal;
  getById(id: string): Goal | null;
  listByCompany(companyId: string, filter?: GoalsListFilter): Goal[];
  updateStatus(id: string, to: GoalStatus, reason?: string | null): Goal;
  updateTitleDescription(id: string, patch: { title?: string; description?: string | null }): Goal;
  setIsaPath(id: string, isaPath: string): void;
  // M8.6 narrated execution
  setExecutionState(goalId: string, state: ExecutionState | null): void;
  getExecutionState(goalId: string): ExecutionState | null;
  findActiveNarratedByCeo(ceoId: string): Goal | null;
  findStuckNarrated(): Goal[];
};

const ALLOWED_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["proposed", "cancelled"],
  proposed: ["planning", "approved", "cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["verifying", "achieved", "cancelled"],
  verifying: ["achieved", "in_progress", "cancelled"],
  achieved: [],
  cancelled: [],
};

type GoalRow = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  level: string;
  status: string;
  parent_goal_id: string | null;
  owner_agent_id: string | null;
  budget_max_tokens: number | null;
  deadline: number | null;
  success_criteria: string | null;
  isa_path: string | null;
  created_at: number;
  updated_at: number;
};

const rowToGoal = (row: GoalRow): Goal => ({
  id: row.id,
  companyId: row.company_id,
  title: row.title,
  description: row.description,
  level: row.level as GoalLevel,
  status: row.status as GoalStatus,
  parentGoalId: row.parent_goal_id,
  ownerAgentId: row.owner_agent_id,
  budgetMaxTokens: row.budget_max_tokens,
  deadline: row.deadline,
  successCriteria: row.success_criteria,
  isaPath: row.isa_path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const createGoalsRepository = (db: Database.Database): GoalsRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO goals (
      id, company_id, title, description, level, status, parent_goal_id,
      owner_agent_id, budget_max_tokens, deadline, success_criteria,
      created_at, updated_at
    ) VALUES (
      @id, @companyId, @title, @description, @level, @status, @parentGoalId,
      @ownerAgentId, @budgetMaxTokens, @deadline, @successCriteria,
      @createdAt, @updatedAt
    )
  `);

  const getByIdStmt = db.prepare(`SELECT * FROM goals WHERE id = ?`);

  const listStmt = db.prepare(`
    SELECT * FROM goals
    WHERE company_id = ?
      AND (@status IS NULL OR status = @status)
      AND (@hasParent = 0 OR parent_goal_id IS @parentGoalId)
    ORDER BY created_at DESC
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE goals SET status = ?, updated_at = ? WHERE id = ?
  `);

  const updateTitleDescStmt = db.prepare(`
    UPDATE goals SET
      title = COALESCE(@title, title),
      description = COALESCE(@description, description),
      updated_at = @updatedAt
    WHERE id = @id
  `);

  const setIsaPathStmt = db.prepare("UPDATE goals SET isa_path = ?, updated_at = ? WHERE id = ?");

  const setExecStateStmt = db.prepare(
    "UPDATE goals SET execution_state_json = ?, updated_at = ? WHERE id = ?",
  );
  const getExecStateStmt = db.prepare("SELECT execution_state_json FROM goals WHERE id = ?");
  const findActiveByCeoStmt = db.prepare(
    `SELECT * FROM goals
     WHERE status = 'approved'
       AND execution_state_json IS NOT NULL
       AND execution_state_json LIKE '%"ceoId":"' || ? || '"%'`,
  );
  const findStuckStmt = db.prepare(
    "SELECT * FROM goals WHERE status = 'approved' AND execution_state_json IS NOT NULL",
  );

  const create = (input: CreateGoalInput): Goal => {
    const id = `goal_${randomUUID()}`;
    const now = Date.now();
    const row = {
      id,
      companyId: input.companyId,
      title: input.title,
      description: input.description ?? null,
      level: input.level ?? "task",
      status: "draft" as GoalStatus,
      parentGoalId: input.parentGoalId ?? null,
      ownerAgentId: input.ownerAgentId ?? null,
      budgetMaxTokens: input.budgetMaxTokens ?? null,
      deadline: input.deadline ?? null,
      successCriteria: input.successCriteria ?? null,
      createdAt: now,
      updatedAt: now,
    };
    insertStmt.run(row);
    return rowToGoal({
      id: row.id,
      company_id: row.companyId,
      title: row.title,
      description: row.description,
      level: row.level,
      status: row.status,
      parent_goal_id: row.parentGoalId,
      owner_agent_id: row.ownerAgentId,
      budget_max_tokens: row.budgetMaxTokens,
      deadline: row.deadline,
      success_criteria: row.successCriteria,
      isa_path: null,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    });
  };

  const getById = (id: string): Goal | null => {
    const row = getByIdStmt.get(id) as GoalRow | undefined;
    return row ? rowToGoal(row) : null;
  };

  const listByCompany = (companyId: string, filter?: GoalsListFilter): Goal[] => {
    const params = {
      status: filter?.status ?? null,
      hasParent: filter?.parentGoalId !== undefined ? 1 : 0,
      parentGoalId: filter?.parentGoalId ?? null,
    };
    const rows = listStmt.all(companyId, params) as GoalRow[];
    return rows.map(rowToGoal);
  };

  const updateStatus = (id: string, to: GoalStatus, _reason?: string | null): Goal => {
    const current = getById(id);
    if (!current) throw new Error(`goal ${id} not found`);
    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.includes(to)) {
      throw new Error(`invalid transition: goal ${id} cannot move from ${current.status} to ${to}`);
    }
    updateStatusStmt.run(to, Date.now(), id);
    const after = getById(id);
    if (!after) throw new Error(`goal ${id} disappeared after update`);
    return after;
  };

  const updateTitleDescription = (
    id: string,
    patch: { title?: string; description?: string | null },
  ): Goal => {
    updateTitleDescStmt.run({
      id,
      title: patch.title ?? null,
      description: patch.description ?? null,
      updatedAt: Date.now(),
    });
    const after = getById(id);
    if (!after) throw new Error(`goal ${id} not found`);
    return after;
  };

  const setIsaPath = (id: string, isaPath: string): void => {
    setIsaPathStmt.run(isaPath, Date.now(), id);
  };

  const setExecutionState = (goalId: string, state: ExecutionState | null): void => {
    setExecStateStmt.run(state === null ? null : JSON.stringify(state), Date.now(), goalId);
  };

  const getExecutionState = (goalId: string): ExecutionState | null => {
    const row = getExecStateStmt.get(goalId) as { execution_state_json: string | null } | undefined;
    if (row === undefined || row.execution_state_json === null) return null;
    return JSON.parse(row.execution_state_json) as ExecutionState;
  };

  const findActiveNarratedByCeo = (ceoId: string): Goal | null => {
    // LIKE may return false-positives if ceoId appears as substring in another
    // field's value; filter by parsing JSON.
    const rows = findActiveByCeoStmt.all(ceoId) as GoalRow[];
    for (const row of rows) {
      try {
        // execution_state_json column not in GoalRow type — read raw
        const stateRaw = (row as unknown as { execution_state_json: string | null })
          .execution_state_json;
        if (stateRaw === null) continue;
        const parsed = JSON.parse(stateRaw) as ExecutionState;
        if (parsed.ceoId === ceoId) return rowToGoal(row);
      } catch {
        continue;
      }
    }
    return null;
  };

  const findStuckNarrated = (): Goal[] => (findStuckStmt.all() as GoalRow[]).map(rowToGoal);

  return {
    create,
    getById,
    listByCompany,
    updateStatus,
    updateTitleDescription,
    setIsaPath,
    setExecutionState,
    getExecutionState,
    findActiveNarratedByCeo,
    findStuckNarrated,
  };
};
