import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import {
  listFiles,
  readFile,
  writeFile,
  addFile,
  deleteFile,
  type InstructionFile,
} from "../agents/instruction-bundle.js";

export const registerInstructionsHandlers = (db: Database.Database): void => {
  const agents = createAgentsRepository(db);
  const userDataDir = app.getPath("userData");

  const requireAgent = (agentId: string) => {
    const agent = agents.getById(agentId);
    if (agent === null) throw new Error(`agent not found: ${agentId}`);
    return agent;
  };

  ipcMain.handle(
    IPC.INSTRUCTIONS_LIST,
    (_e, payload: { agentId: string }): { files: InstructionFile[] } => {
      return { files: listFiles(userDataDir, requireAgent(payload.agentId)) };
    },
  );

  ipcMain.handle(
    IPC.INSTRUCTIONS_READ,
    (_e, payload: { agentId: string; filename: string }): { body: string } => {
      return { body: readFile(userDataDir, requireAgent(payload.agentId), payload.filename) };
    },
  );

  ipcMain.handle(
    IPC.INSTRUCTIONS_WRITE,
    (_e, payload: { agentId: string; filename: string; body: string }): { ok: true } => {
      writeFile(userDataDir, requireAgent(payload.agentId), payload.filename, payload.body);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.INSTRUCTIONS_ADD,
    (_e, payload: { agentId: string; filename: string }): { ok: true } => {
      addFile(userDataDir, requireAgent(payload.agentId), payload.filename);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.INSTRUCTIONS_DELETE,
    (_e, payload: { agentId: string; filename: string }): { ok: true } => {
      deleteFile(userDataDir, requireAgent(payload.agentId), payload.filename);
      return { ok: true };
    },
  );
};
