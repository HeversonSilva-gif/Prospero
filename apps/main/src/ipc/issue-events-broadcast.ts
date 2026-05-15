import { BrowserWindow } from "electron";
import { IPC } from "@prospero/shared";

export type IssueChangedEvent =
  | { kind: "created"; issueId: string; companyId: string }
  | { kind: "updated"; issueId: string; companyId: string }
  | { kind: "deleted"; issueId: string; companyId: string }
  | { kind: "comment-added"; issueId: string; companyId: string };

export const broadcastIssueChanged = (event: IssueChangedEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.ISSUES_CHANGED, event);
  }
};
