import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Message } from "@dashboard-agent/shared";
import { createMessagesRepository } from "../messages/repository.js";

export const registerMessagesHandlers = (db: Database.Database): void => {
  const repo = createMessagesRepository(db);
  ipcMain.handle(
    IPC.MESSAGE_LIST,
    (_e, payload: { companyId: string; participants: string[] }): Message[] =>
      repo.listByParticipants(payload.companyId, payload.participants),
  );
  ipcMain.handle(IPC.MESSAGE_LIST_BY_AGENT, (_e, payload: { agentId: string }): Message[] =>
    repo.listByAgentParticipating(payload.agentId),
  );
};
