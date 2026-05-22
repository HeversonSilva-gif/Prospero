import { app, BrowserWindow } from "electron";
import type { Tray } from "electron";
import type Database from "better-sqlite3";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { IPC } from "@prospero/shared";
import { createMainWindow } from "./window/main-window.js";
import { registerIpcHandlers } from "./ipc/handlers.js";
import { registerWindowHandlers } from "./ipc/window-handlers.js";
import { createTray } from "./tray/index.js";
import { openDatabase } from "./db/client.js";
import { databasePath } from "./db/path.js";
import { startPermissionWatcher } from "./security/permission-watcher.js";
import { getPermissionsDir } from "./security/permissions-dir.js";
import { getAgentSandboxCwd } from "./orchestrator/util/paths.js";
import { broadcastPermissionRequest } from "./ipc/permission-handlers.js";
import { broadcastInboxUpdate } from "./ipc/inbox-handlers.js";
import { createInboxRepository } from "./inbox/repository.js";
import { createAgentsRepository } from "./agents/repository.js";
import { createApprovalsRepository } from "./approvals/repository.js";
import { isCeoAgent } from "@prospero/shared";
import { routeAndDispatch } from "./approvals/index.js";
import { createProjectsRepository } from "./projects/repository.js";
import { getRecorder } from "./activity/index.js";
import { startHeartbeat } from "./orchestrator/heartbeat.js";
import { getAdapter } from "./orchestrator/lifecycle.js";
import { runMemoryMaintenance } from "./memory/maintenance.js";
import { initUpdater, checkForUpdatesOnLaunch } from "./updater/index.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: Database.Database | null = null;
let stopPermissionWatcher: (() => Promise<void>) | null = null;
let stopHeartbeat: (() => void) | null = null;

const getWindow = (): BrowserWindow | null => mainWindow;

// E2E support: when PROSPERO_USER_DATA is set, point Electron at an
// isolated tmp directory so the suite doesn't touch the user's real DB.
const e2eUserData = process.env["PROSPERO_USER_DATA"];
if (e2eUserData !== undefined && e2eUserData !== "") {
  app.setPath("userData", e2eUserData);
}

// Auto-restart on uncaught exception. Best-effort log to userData/emergency.log
// then relaunch after a 5s window. The window lets log flush + IPC drain.
const logEmergency = (err: unknown): void => {
  try {
    const dir = app.getPath("userData");
    const path = join(dir, "emergency.log");
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    appendFileSync(path, `[${new Date().toISOString()}] uncaughtException: ${msg}\n\n`);
  } catch {
    // best effort
  }
};

process.on("uncaughtException", (err) => {
  logEmergency(err);
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 5_000);
});

// Bootstrap runs inside whenReady().then(); a throw there becomes a rejected
// promise. Without this, a packaged-app bootstrap failure (e.g. a native module
// that fails to load) is silent — no dialog, no window, no log.
process.on("unhandledRejection", (reason) => {
  logEmergency(reason);
});

void app
  .whenReady()
  .then(() => {
    db = openDatabase(databasePath());
    registerIpcHandlers(db);

    // M11 PR-F1: decay/prune the memory store once per session.
    try {
      const maintenance = runMemoryMaintenance(db, Date.now());
      if (maintenance.ran) {
        console.warn(
          `[memory] maintenance: decayed ${maintenance.decayed}, ` +
            `warned ${maintenance.warned}, pruned ${maintenance.pruned}, ` +
            `purged ${maintenance.purgedSkills} skills`,
        );
      }
    } catch (err) {
      console.warn(`[memory] maintenance pass failed: ${String(err)}`);
    }

    // Permission watcher (M5 spec §6.4)
    const agentsRepo = createAgentsRepository(db, getRecorder());
    const projectsRepo = createProjectsRepository(db, getRecorder());
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
      userDataDir,
      onUserDecision: (req, reason) => {
        console.log(
          `[m5/permission] onUserDecision toolUseId=${req.toolUseId} agentId=${req.agentId} tool=${req.toolName} reason=${reason}`,
        );
        broadcastPermissionRequest(req);
        const agent = agentsRepo.getById(req.agentId);
        if (agent === null) return;

        const approvals = createApprovalsRepository(db!);
        const apv = approvals.findPendingByToolUseId(req.toolUseId);
        if (apv !== null) {
          routeAndDispatch({
            approvalId: apv.id,
            companyId: agent.companyId,
            kind: "tool_call",
            reason,
            requesterIsCeo: isCeoAgent(agent),
            requesterName: agent.name,
            summary: `${req.toolName} ${JSON.stringify(req.toolInput).slice(0, 120)}`,
          });
        } else {
          // Edge/legacy — no approval row: create the human card directly.
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
        }

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
    registerWindowHandlers(mainWindow);
    tray = createTray(getWindow);

    // M17 — auto-update: register the IPC bridge + event handlers, then kick off
    // a background check (no-op in dev / unpackaged).
    initUpdater();
    checkForUpdatesOnLaunch();

    stopHeartbeat = startHeartbeat({
      db,
      agents: agentsRepo,
      inbox: inboxRepo,
      broadcastInbox: broadcastInboxUpdate,
      thresholdMs: 5 * 60_000,
      // Only flag agents whose claude process actually died. An alive-but-quiet
      // agent is mid long-running turn (running tests, reading the repo) — it
      // emits no activity_event for minutes but must not be marked "error".
      isAlive: (agentId) => getAdapter(agentId)?.isAlive() ?? false,
    });
  })
  .catch(logEmergency);

app.on("window-all-closed", () => {
  // Intentionally empty — keep app alive in tray.
});

app.on("activate", () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
});

app.on("before-quit", () => {
  stopHeartbeat?.();
  stopHeartbeat = null;
  void stopPermissionWatcher?.();
  stopPermissionWatcher = null;
  tray?.destroy();
  tray = null;
  db?.close();
  db = null;
});
