import type Database from "better-sqlite3";
import { createGoalsRepository } from "./repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { formatGoalPlanRequest } from "./format-request.js";

export type RecoveryDeps = {
  deliverSystemMessage: (agentId: string, text: string) => void;
};

export const scanPlanningWithoutPlan = (db: Database.Database, deps: RecoveryDeps): number => {
  const goalsRepo = createGoalsRepository(db);
  const agentsRepo = createAgentsRepository(db);

  const stuck = db
    .prepare(
      `SELECT * FROM goals g
       WHERE g.status = 'planning'
       AND NOT EXISTS (
         SELECT 1 FROM goal_plans p
         WHERE p.goal_id = g.id AND p.status = 'proposed'
       )`,
    )
    .all() as { id: string; company_id: string }[];

  let enqueued = 0;
  for (const row of stuck) {
    const goal = goalsRepo.getById(row.id);
    if (!goal) continue;
    const ceo = agentsRepo
      .listByCompany(row.company_id)
      .find((a) => a.templateId === "ceo" || a.role === "ceo");
    if (!ceo) continue;
    deps.deliverSystemMessage(ceo.id, formatGoalPlanRequest(goal));
    enqueued++;
  }
  return enqueued;
};
