import { ipcMain, shell } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Attachment } from "@prospero/shared";
import {
  persistAttachment,
  deleteAttachment,
  validateAttachment,
} from "../messages/attachments.js";

export const registerAttachmentHandlers = (
  db: Database.Database,
  getUserDataDir: () => string,
): void => {
  ipcMain.handle(
    IPC.ATTACHMENTS_UPLOAD,
    async (
      _e,
      payload: { buffer: Buffer; filename: string; mimeType: string },
    ): Promise<Attachment> => {
      const validation = validateAttachment(payload.buffer, payload.mimeType);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      return persistAttachment({
        db,
        buffer: payload.buffer,
        filename: payload.filename,
        mimeType: payload.mimeType,
        messageId: null,
        userDataDir: getUserDataDir(),
      });
    },
  );

  ipcMain.handle(IPC.ATTACHMENTS_DELETE, (_e, id: string): void => {
    deleteAttachment(id, db);
  });

  ipcMain.handle(
    IPC.ATTACHMENTS_OPEN,
    async (_e, id: string): Promise<{ ok: true } | { error: string }> => {
      const row = db.prepare("SELECT local_path FROM message_attachments WHERE id = ?").get(id) as
        | { local_path: string }
        | undefined;
      if (row === undefined) return { error: "not-found" };
      const err = await shell.openPath(row.local_path);
      if (err !== "") return { error: err };
      return { ok: true };
    },
  );
};
