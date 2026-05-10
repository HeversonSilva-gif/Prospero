import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { Agent } from "@dashboard-agent/shared";
import { matchesBlockedBash, matchesBlockedPath } from "./blocklist.js";

export type GateInput = {
  toolName: string;
  toolInput: unknown;
  agent: Agent;
  workspaceCwd: string;
};

export type GateDecision =
  | { action: "allow"; reason?: string }
  | { action: "deny"; reason: string }
  | { action: "request_user"; reason: string };

const FS_TOOLS = new Set(["Read", "Write", "Edit", "Glob", "Grep", "MultiEdit", "NotebookEdit"]);

const expandHome = (p: string): string =>
  p.startsWith("~/") || p === "~" ? p.replace(/^~/, homedir()) : p;

const extractPathLikeTokens = (cmd: string): string[] => {
  const tokens = cmd.split(/[\s;|&]+/).filter((t) => t.length > 0);
  return tokens.filter(
    (t) =>
      t.startsWith("/") || t.startsWith("~") || t.startsWith("..") || /^[A-Za-z]:[\\/]/.test(t),
  );
};

const isInsideWorkspace = (path: string, workspace: string): boolean => {
  const abs = resolve(expandHome(path));
  const wsAbs = resolve(workspace);
  return abs === wsAbs || abs.startsWith(wsAbs + (process.platform === "win32" ? "\\" : "/"));
};

export const evaluatePermission = (input: GateInput): GateDecision => {
  const { toolName, toolInput, agent, workspaceCwd } = input;

  if (toolName === "Bash") {
    const cmd = (toolInput as { command?: string }).command ?? "";
    if (matchesBlockedBash(cmd)) {
      return { action: "request_user", reason: "always-blocked bash pattern" };
    }
    for (const tok of extractPathLikeTokens(cmd)) {
      const expanded = expandHome(tok);
      if (matchesBlockedPath(expanded)) {
        return { action: "request_user", reason: "always-blocked path in bash arg" };
      }
      if (!isAbsolute(expanded) && !tok.startsWith("..")) continue;
      if (!isInsideWorkspace(expanded, workspaceCwd)) {
        return { action: "request_user", reason: `bash path outside workspace: ${tok}` };
      }
    }
  } else if (FS_TOOLS.has(toolName)) {
    const ti = toolInput as { file_path?: string; path?: string };
    const path = ti.file_path ?? ti.path ?? "";
    if (path !== "") {
      const expanded = expandHome(path);
      if (matchesBlockedPath(expanded)) {
        return { action: "request_user", reason: "always-blocked sensitive path" };
      }
      const abs = resolve(expanded);
      if (!isInsideWorkspace(abs, workspaceCwd)) {
        return { action: "deny", reason: "path outside workspace" };
      }
    }
  }

  if (agent.mode === "auto") {
    return { action: "allow" };
  }

  return { action: "request_user", reason: "supervised mode" };
};
