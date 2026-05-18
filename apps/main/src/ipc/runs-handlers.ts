// M12 PR-E1: Runs are derived from cost_events — one row per turn, no
// agent_runs table. This handler is a thin read passthrough to the costs
// repository; the drill-in (turn activity) reuses the existing activity:query.

import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type AgentRunRow } from "@prospero/shared";
import { createCostsRepository } from "../costs/repository.js";

export const registerRunsHandlers = (db: Database.Database): void => {
  const repo = createCostsRepository(db);
  ipcMain.handle(IPC.RUNS_LIST, (_e, payload: { agentId: string; limit?: number }): AgentRunRow[] =>
    repo.listRunsByAgent(payload.agentId, payload.limit),
  );
};
