import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@dashboard-agent/shared";

contextBridge.exposeInMainWorld("dashboardAgent", {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
});
