import { BrowserWindow } from "electron";
import { IPC, type AgentEvent } from "@prospero/shared";

// M14 PR-D — shared helper for fan-out of AgentEvent to all renderer windows.
// Mirrors `broadcastInboxUpdate` (M13 PR-F). Imported by repos that mutate
// agent state but don't otherwise pull in the orchestrator handler module.

export const broadcastAgentEvent = (event: AgentEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.AGENT_EVENT, event);
  }
};
