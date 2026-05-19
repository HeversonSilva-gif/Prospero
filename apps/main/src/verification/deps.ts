// Production RunVerificationDeps: resolves a goal's sandbox cwd and a metric
// tool caller. External MCP servers as metric sources are out of scope for
// M13 PR-B1 — an unknown metric tool fails the check cleanly.

import { app, BrowserWindow } from "electron";
import { IPC } from "@prospero/shared";
import { getAgentSandboxCwd } from "../orchestrator/util/paths.js";
import type { RunVerificationDeps } from "./index.js";

export const buildVerificationDeps = (): RunVerificationDeps => {
  let userDataDir = "";
  try {
    userDataDir = app.getPath("userData");
  } catch {
    /* tests run without an Electron app — sandboxRootFor falls back to cwd */
  }
  return {
    sandboxRootFor: (goal) =>
      goal.ownerAgentId !== null && userDataDir !== ""
        ? getAgentSandboxCwd(userDataDir, goal.ownerAgentId)
        : process.cwd(),
    callMetricTool: (tool) => Promise.reject(new Error(`metric tool not available: ${tool}`)),
    notify: (companyId) => {
      try {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.INBOX_UPDATE, { companyId });
        }
      } catch {
        /* no Electron host in tests */
      }
    },
  };
};
