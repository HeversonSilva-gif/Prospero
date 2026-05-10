import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { Agent } from "@dashboard-agent/shared";
import { matchesBlockedBash, matchesBlockedPath } from "./blocklist.js";

export type GateInput = {
  toolName: string;
  toolInput: unknown;
  agent: Agent;
  /** List of absolute project root paths the agent is allowed to access. */
  allowedProjectPaths: string[];
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

const isInsideAnyAllowed = (path: string, allowed: string[]): boolean => {
  if (allowed.length === 0) return false;
  const abs = resolve(expandHome(path));
  return allowed.some((root) => {
    const rootAbs = resolve(root);
    return abs === rootAbs || abs.startsWith(rootAbs + (process.platform === "win32" ? "\\" : "/"));
  });
};

const asObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};

export const evaluatePermission = (input: GateInput): GateDecision => {
  const { toolName, toolInput, agent, allowedProjectPaths } = input;
  const ti = asObject(toolInput);

  if (toolName === "Bash") {
    const cmd = typeof ti["command"] === "string" ? ti["command"] : "";
    if (matchesBlockedBash(cmd)) {
      return { action: "request_user", reason: "always-blocked bash pattern" };
    }
    for (const tok of extractPathLikeTokens(cmd)) {
      const expanded = expandHome(tok);
      if (matchesBlockedPath(expanded)) {
        return { action: "request_user", reason: "always-blocked path in bash arg" };
      }
      if (!isAbsolute(expanded) && !tok.startsWith("..")) continue;
      if (!isInsideAnyAllowed(expanded, allowedProjectPaths)) {
        return { action: "request_user", reason: `bash path outside any allowed project: ${tok}` };
      }
    }
  } else if (FS_TOOLS.has(toolName)) {
    const fp = ti["file_path"];
    const p = ti["path"];
    const path = typeof fp === "string" ? fp : typeof p === "string" ? p : "";
    if (path !== "") {
      const expanded = expandHome(path);
      if (matchesBlockedPath(expanded)) {
        return { action: "request_user", reason: "always-blocked sensitive path" };
      }
      const abs = resolve(expanded);
      if (!isInsideAnyAllowed(abs, allowedProjectPaths)) {
        return { action: "deny", reason: "path outside allowed projects" };
      }
    }
  }

  if (agent.mode === "auto") {
    return { action: "allow" };
  }

  return { action: "request_user", reason: "supervised mode" };
};
