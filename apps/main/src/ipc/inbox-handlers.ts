import { ipcMain, BrowserWindow } from "electron";
import type Database from "better-sqlite3";
import { IPC, type InboxItem } from "@dashboard-agent/shared";
import { createInboxRepository } from "../inbox/repository.js";

export const broadcastInboxUpdate = (companyId: string): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.INBOX_UPDATE, { companyId });
  }
};

export const registerInboxHandlers = (db: Database.Database): void => {
  const inbox = createInboxRepository(db);
  ipcMain.handle(IPC.INBOX_LIST, (_e, payload: { companyId: string }): InboxItem[] =>
    inbox.listByCompany(payload.companyId),
  );
  ipcMain.handle(IPC.INBOX_MARK_READ, (_e, payload: { id: string }): void => {
    inbox.markRead(payload.id);
  });
};
