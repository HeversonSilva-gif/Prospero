import { app } from "electron";
import type { BrowserWindow, Tray } from "electron";
import type Database from "better-sqlite3";
import { createMainWindow } from "./window/main-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/index.js";
import { openDatabase } from "./db/client.js";
import { databasePath } from "./db/path.js";
import { startPermissionWatcher } from "./security/permission-watcher.js";
import { getPermissionsDir } from "./security/permissions-dir.js";
import { resolveWorkspaceCwd } from "./settings/workspace.js";
import { broadcastPermissionRequest } from "./ipc/permission-handlers.js";
import { createInboxRepository } from "./inbox/repository.js";
import { createSettingsRepository } from "./settings/repository.js";
import { createAgentsRepository } from "./agents/repository.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;
let stopPermissionWatcher: (() => Promise<void>) | null = null;

const getWindow = (): BrowserWindow | null => mainWindow;

void app.whenReady().then(() => {
  db = openDatabase(databasePath());
  registerIpcHandlers(db);

  // Permission watcher (M5 spec §6.4)
  const settingsRepo = createSettingsRepository(db);
  const agentsRepo = createAgentsRepository(db);
  const inboxRepo = createInboxRepository(db);
  const permissionsDir = getPermissionsDir(app.getPath("userData"));
  stopPermissionWatcher = startPermissionWatcher({
    dir: permissionsDir,
    getAgent: (id) => agentsRepo.getById(id),
    getWorkspaceCwd: () => resolveWorkspaceCwd(settingsRepo.read().workspaceCwd),
    onUserDecision: (req, reason) => {
      broadcastPermissionRequest(req);
      const agent = agentsRepo.getById(req.agentId);
      if (agent === null) return;
      inboxRepo.create({
        companyId: agent.companyId,
        kind: "approval",
        actorId: req.agentId,
        title: `Approval needed: ${req.toolName}`,
        preview:
          typeof req.toolInput === "object" && req.toolInput !== null
            ? JSON.stringify(req.toolInput).slice(0, 200)
            : null,
        requiresAction: true,
        payloadJson: JSON.stringify({
          toolUseId: req.toolUseId,
          toolName: req.toolName,
          toolInput: req.toolInput,
          reason,
        }),
      });
    },
  });

  mainWindow = createMainWindow();
  tray = createTray(getWindow);
});

app.on("window-all-closed", () => {
  // Intentionally empty — keep app alive in tray.
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});

app.on("before-quit", () => {
  void stopPermissionWatcher?.();
  stopPermissionWatcher = null;
  tray?.destroy();
  tray = null;
  db?.close();
  db = null;
});
