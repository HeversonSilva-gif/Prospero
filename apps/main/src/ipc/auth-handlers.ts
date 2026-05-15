import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { homedir } from "node:os";
import {
  IPC,
  type ApiKeyStatus,
  type DetectResult,
  type TokenSource,
  type TokenStatus,
} from "@prospero/shared";
import { saveToken, loadTokenStatus, clearToken } from "../auth/token-storage.js";
import { saveApiKey, loadApiKeyStatus, clearApiKey } from "../auth/api-key-storage.js";
import { detectClaudeCliToken } from "../auth/token-detect.js";
import { redactToken } from "../auth/token-redact.js";

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

  // Returns only a masked prefix — never the raw token. The renderer uses this to show a
  // preview ("we found sk-ant-oat-***") and then calls AUTH_TOKEN_IMPORT_DETECTED to
  // actually import. The raw token never crosses the process boundary toward the renderer.
  ipcMain.handle(IPC.AUTH_TOKEN_DETECT, (): DetectResult => {
    const detected = detectClaudeCliToken(homeDirProvider());
    if (detected === null) return { found: false };
    return { found: true, maskedPrefix: redactToken(detected.token) };
  });

  // Re-detects and saves in one shot, all on the main side. Returns the resulting status.
  ipcMain.handle(IPC.AUTH_TOKEN_IMPORT_DETECTED, (): Promise<TokenStatus> => {
    return Promise.resolve().then(() => {
      const detected = detectClaudeCliToken(homeDirProvider());
      if (detected === null) {
        throw new Error("No Claude CLI token detected to import");
      }
      saveToken(db, {
        raw: detected.token,
        source: "auto-detect",
        expiresAt: detected.expiresAt,
      });
      return loadTokenStatus(db);
    });
  });

  ipcMain.handle(IPC.AUTH_TOKEN_CLEAR, (): TokenStatus => {
    clearToken(db);
    return loadTokenStatus(db);
  });

  ipcMain.handle(IPC.AUTH_API_KEY_STATUS, (): ApiKeyStatus => loadApiKeyStatus(db));

  ipcMain.handle(IPC.AUTH_API_KEY_SET, (_event, payload: unknown): Promise<ApiKeyStatus> => {
    return Promise.resolve().then(() => {
      if (
        payload === null ||
        typeof payload !== "object" ||
        typeof (payload as { raw: string }).raw !== "string"
      ) {
        throw new Error("Invalid payload for api-key-set");
      }
      saveApiKey(db, (payload as { raw: string }).raw);
      return loadApiKeyStatus(db);
    });
  });

  ipcMain.handle(IPC.AUTH_API_KEY_CLEAR, (): ApiKeyStatus => {
    clearApiKey(db);
    return loadApiKeyStatus(db);
  });
};
