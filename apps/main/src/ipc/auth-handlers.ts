import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { homedir } from "node:os";
import { IPC, type TokenSource, type TokenStatus } from "@dashboard-agent/shared";
import { saveToken, loadTokenStatus, clearToken } from "../auth/token-storage.js";
import { detectClaudeCliToken } from "../auth/token-detect.js";

type SetPayload = { raw: string; source: TokenSource };

export const registerAuthHandlers = (
  db: Database.Database,
  homeDirProvider: () => string = homedir,
): void => {
  ipcMain.handle(IPC.AUTH_TOKEN_STATUS, (): TokenStatus => loadTokenStatus(db));

  ipcMain.handle(IPC.AUTH_TOKEN_SET, (_event, payload: unknown): Promise<TokenStatus> => {
    return Promise.resolve().then(() => {
      if (
        payload === null ||
        typeof payload !== "object" ||
        typeof (payload as SetPayload).raw !== "string"
      ) {
        throw new Error("Invalid payload for token-set");
      }
      const { raw, source } = payload as SetPayload;
      saveToken(db, { raw, source });
      return loadTokenStatus(db);
    });
  });

  ipcMain.handle(IPC.AUTH_TOKEN_DETECT, (): string | null =>
    detectClaudeCliToken(homeDirProvider()),
  );

  ipcMain.handle(IPC.AUTH_TOKEN_CLEAR, (): TokenStatus => {
    clearToken(db);
    return loadTokenStatus(db);
  });
};
