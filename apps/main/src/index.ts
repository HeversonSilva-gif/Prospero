import { app, BrowserWindow } from "electron";
import type { Tray } from "electron";
import type Database from "better-sqlite3";
import { IPC } from "@dashboard-agent/shared";
import { createMainWindow } from "./window/main-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { createTray } from "./tray/index.js";
import { openDatabase } from "./db/client.js";
import { databasePath } from "./db/path.js";
import { startPermissionWatcher } from "./security/permission-watcher.js";
import { getPermissionsDir } from "./security/permissions-dir.js";
import { resolveWorkspaceCwd } from "./settings/workspace.js";
import { broadcastPermissionRequest } from "./ipc/permission-handlers.js";
import { broadcastInboxUpdate } from "./ipc/inbox-handlers.js";
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
      const wins = BrowserWindow.getAllWindows();
      console.log(
        `[m5/permission] onUserDecision toolUseId=${req.toolUseId} agentId=${req.agentId} tool=${req.toolName} reason=${reason} wins=${String(wins.length)}`,
      );
      broadcastPermissionRequest(req);
      const agent = agentsRepo.getById(req.agentId);
      if (agent === null) {
        console.log(`[m5/permission] WARN agent not found: ${req.agentId}`);
        return;
      }
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
      broadcastInboxUpdate(agent.companyId);
      agentsRepo.updateStatus(req.agentId, {
        status: "waiting",
        currentAction: `Awaiting approval: ${req.toolName}`.slice(0, 80),
      });
      for (const win of wins) {
        win.webContents.send(IPC.AGENT_EVENT, {
          kind: "status",
          agentId: req.agentId,
          status: "waiting",
          currentAction: `Awaiting approval: ${req.toolName}`.slice(0, 80),
        });
      }
    },
    onResolved: (toolUseId, resolution) => {
      console.log(
        `[m5/permission] onResolved FIRED toolUseId=${toolUseId} behavior=${resolution.behavior}`,
      );
      // When a permission is resolved (.res.json or .deny.json appears), find the
      // matching inbox approval item and mark it read. Works for both inline
      // ApprovalCard and Inbox-route approvals — both write the same fence file.
      const updated = inboxRepo.markReadByToolUseId(toolUseId);
      if (updated !== null) {
        console.log(
          `[m5/permission] onResolved markRead HIT itemId=${updated.id} companyId=${updated.companyId}`,
        );
        broadcastInboxUpdate(updated.companyId);
      } else {
        console.log(`[m5/permission] onResolved markRead NO-HIT for ${toolUseId}`);
      }
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
