import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import { IPC, type UpdaterStatus } from "@prospero/shared";

// electron-updater is CommonJS; under our ESM main the named export is reached
// via the default import.
const { autoUpdater } = electronUpdater;

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

let status: UpdaterStatus = { state: "idle", version: null, percent: null, error: null };
let wired = false;

const broadcast = (next: UpdaterStatus): void => {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.UPDATER_EVENT, status);
  }
};

// Registers the IPC bridge + autoUpdater event handlers. Idempotent. The IPC
// handlers are registered even in dev (so the UI renders), but the actual
// network check is gated on app.isPackaged — electron-updater throws without a
// real installed app + latest.yml.
export const initUpdater = (): void => {
  if (wired) return;
  wired = true;

  ipcMain.handle(IPC.UPDATER_STATUS, (): UpdaterStatus => status);
  ipcMain.handle(IPC.UPDATER_CHECK_NOW, async (): Promise<void> => {
    if (!app.isPackaged) return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      broadcast({ state: "error", version: status.version, percent: null, error: errMsg(err) });
    }
  });
  ipcMain.handle(IPC.UPDATER_INSTALL_NOW, (): void => {
    if (status.state === "downloaded") autoUpdater.quitAndInstall();
  });

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    broadcast({ state: "checking", version: null, percent: null, error: null });
  });
  autoUpdater.on("update-available", (info) => {
    broadcast({ state: "downloading", version: info.version, percent: 0, error: null });
  });
  autoUpdater.on("update-not-available", () => {
    broadcast({ state: "idle", version: null, percent: null, error: null });
  });
  autoUpdater.on("download-progress", (p) => {
    broadcast({
      state: "downloading",
      version: status.version,
      percent: Math.round(p.percent),
      error: null,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    broadcast({ state: "downloaded", version: info.version, percent: 100, error: null });
  });
  autoUpdater.on("error", (err) => {
    broadcast({ state: "error", version: status.version, percent: null, error: errMsg(err) });
  });
};

// Background check at launch. Silent in dev (no real install to update).
export const checkForUpdatesOnLaunch = (): void => {
  if (!app.isPackaged) return;
  void autoUpdater.checkForUpdates().catch((err: unknown) => {
    broadcast({ state: "error", version: status.version, percent: null, error: errMsg(err) });
  });
};
