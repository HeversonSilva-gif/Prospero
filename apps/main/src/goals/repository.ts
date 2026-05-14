import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Goal, GoalLevel, GoalStatus, CreateGoalInput } from "@dashboard-agent/shared";

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
};

const ALLOWED_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["proposed", "cancelled"],
  proposed: ["planning", "approved", "cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["achieved", "cancelled"],
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

  return { create, getById, listByCompany, updateStatus, updateTitleDescription };
};
