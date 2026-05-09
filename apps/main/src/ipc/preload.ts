import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@dashboard-agent/shared";
import type { AppSettings, TokenSource, TokenStatus } from "@dashboard-agent/shared";

contextBridge.exposeInMainWorld("dashboardAgent", {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch),
  },
  auth: {
    status: (): Promise<TokenStatus> => ipcRenderer.invoke(IPC.AUTH_TOKEN_STATUS),
    set: (raw: string, source: TokenSource): Promise<TokenStatus> =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_SET, { raw, source }),
    detect: (): Promise<string | null> => ipcRenderer.invoke(IPC.AUTH_TOKEN_DETECT),
    clear: (): Promise<TokenStatus> => ipcRenderer.invoke(IPC.AUTH_TOKEN_CLEAR),
  },
});
