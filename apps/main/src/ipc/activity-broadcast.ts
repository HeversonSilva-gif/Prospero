// Sends ACTIVITY_NEW to every renderer. Kept in a separate module so the
// recorder (apps/main/src/activity/recorder.ts) can be unit-tested without
// importing electron — tests inject a vi.fn() instead of this helper.

import { BrowserWindow } from "electron";
import { IPC, type ActivityEventRow } from "@prospero/shared";

export const broadcastActivityNew = (row: ActivityEventRow): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.ACTIVITY_NEW, row);
  }
};
