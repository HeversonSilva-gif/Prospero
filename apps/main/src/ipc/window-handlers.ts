// Window control handlers — the renderer's custom TitleBar talks to these
// to minimize / maximize / close. We also broadcast maximize-state changes
// so the maximize button can swap its icon (□ ↔ ❐).

import { ipcMain, BrowserWindow, type BrowserWindow as BW } from "electron";
import { IPC } from "@dashboard-agent/shared";

const broadcastState = (win: BW): void => {
  const isMax = win.isMaximized();
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC.WINDOW_STATE_CHANGED, { isMaximized: isMax });
  }
};

export const registerWindowHandlers = (win: BW): void => {
  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => {
    win.minimize();
  });

  ipcMain.handle(IPC.WINDOW_MAXIMIZE_TOGGLE, () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    win.close();
  });

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => win.isMaximized());

  win.on("maximize", () => broadcastState(win));
  win.on("unmaximize", () => broadcastState(win));
};
