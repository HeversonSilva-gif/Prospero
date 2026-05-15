import { z } from "zod";
import { BrowserWindow } from "electron";
import { IPC } from "@prospero/shared";
import { createIssuesRepository } from "../issues/repository.js";
import { createIssueCommentsRepository } from "../issues/comments-repository.js";
import { tryGetRecorder } from "../activity/index.js";
import type { ToolContext } from "./tools.js";

type Tool = {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  run: (input: unknown, ctx: ToolContext) => Promise<string>;
};

// M5 lesson: collapse newline runs + trim so model-injected control patterns
// cannot embed extra `[GOAL_*]` markers or stream control characters.
const sanitizeComment = (raw: string): string =>
  raw
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const commentOnIssue: Tool = {
  name: "comment_on_issue",
  description:
    "Add a comment to an issue. The sender is the current agent. Use this during narrated plan execution to explain rationale, or anytime to communicate progress on an issue.",
  inputSchema: z.object({
    issueId: z.string(),
    comment: z.string().min(1).max(5000),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { issueId, comment } = commentOnIssue.inputSchema.parse(input) as {
      issueId: string;
      comment: string;
    };
    const issuesRepo = createIssuesRepository(ctx.db);
    const issue = issuesRepo.getById(issueId);
    if (issue === null || issue.companyId !== ctx.companyId) {
      throw new Error(`issue ${issueId} not found`);
    }
    const sanitized = sanitizeComment(comment);
    if (sanitized.length === 0) {
      throw new Error("comment empty after sanitization");
    }
    const created = createIssueCommentsRepository(ctx.db).add({
      issueId,
      senderKind: "agent",
      senderId: ctx.agentId,
      content: sanitized,
    });
    tryGetRecorder()?.recordActivity({
      companyId: ctx.companyId,
      actor: { kind: "agent", id: ctx.agentId },
      action: "issue.commented",
      entityKind: "issue",
      entityId: issueId,
      agentId: ctx.agentId,
      payload: { commentId: created.id, length: sanitized.length },
    });
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.ISSUES_CHANGED, {
          kind: "comment-added",
          issueId,
          companyId: ctx.companyId,
        });
      }
    } catch {
      /* tests run without an Electron host */
    }
    return JSON.stringify({ commentId: created.id, createdAt: created.createdAt });
  },
};

export const issuesToolDefinitions: Tool[] = [commentOnIssue];
