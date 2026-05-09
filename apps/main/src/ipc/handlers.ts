import { ipcMain } from "electron";
import { IPC } from "@dashboard-agent/shared";

export const registerIpcHandlers = (): void => {
  ipcMain.handle(IPC.PING, () => "pong");
};
