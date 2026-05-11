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
import { getAgentSandboxCwd } from "./orchestrator/lifecycle.js";
import { broadcastPermissionRequest } from "./ipc/permission-handlers.js";
import { broadcastInboxUpdate } from "./ipc/inbox-handlers.js";
import { createInboxRepository } from "./inbox/repository.js";
import { createAgentsRepository } from "./agents/repository.js";
import { createProjectsRepository } from "./projects/repository.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;
let stopPermissionWatcher: (() => Promise<void>) | null = null;

const getWindow = (): BrowserWindow | null => mainWindow;

void app.whenReady().then(() => {
  db = openDatabase(databasePath());
  registerIpcHandlers(db);

  // Permission watcher (M5 spec §6.4)
  const agentsRepo = createAgentsRepository(db);
  const projectsRepo = createProjectsRepository(db);
  const inboxRepo = createInboxRepository(db);
  const permissionsDir = getPermissionsDir(app.getPath("userData"));
  const userDataDir = app.getPath("userData");
  stopPermissionWatcher = startPermissionWatcher({
    dir: permissionsDir,
    getAgent: (id) => agentsRepo.getById(id),
    getAllowedProjectPaths: (agentId: string) => {
      const agent = agentsRepo.getById(agentId);
      if (agent === null) return [];
      const projects = projectsRepo.listByCompany(agent.companyId);
      if (agent.allowedProjects.length === 0) return projects.map((p) => p.path);
      return projects.filter((p) => agent.allowedProjects.includes(p.id)).map((p) => p.path);
    },
    getAgentCwd: (agentId: string) => getAgentSandboxCwd(userDataDir, agentId),
    onUserDecision: (req, reason) => {
      console.log(
        `[m5/permission] onUserDecision toolUseId=${req.toolUseId} agentId=${req.agentId} tool=${req.toolName} reason=${reason}`,
      );
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
      broadcastInboxUpdate(agent.companyId);
      agentsRepo.updateStatus(req.agentId, {
        status: "waiting",
        currentAction: `Awaiting approval: ${req.toolName}`.slice(0, 80),
      });
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.AGENT_EVENT, {
          kind: "status",
          agentId: req.agentId,
          status: "waiting",
          currentAction: `Awaiting approval: ${req.toolName}`.slice(0, 80),
        });
      }
    },
    // Note: inbox markRead + broadcast on user-decision approve/reject is handled
    // directly inside the IPC permission:resolve handler (avoids a chokidar race
    // where MCP child polling can unlink the fence file before chokidar fires `add`
    // due to awaitWriteFinish stability window).
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
