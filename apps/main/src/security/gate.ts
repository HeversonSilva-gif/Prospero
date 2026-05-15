import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { Agent } from "@prospero/shared";
import { matchesBlockedBash, matchesBlockedPath } from "./blocklist.js";

export type GateInput = {
  toolName: string;
  toolInput: unknown;
  agent: Agent;
  /** List of absolute project root paths the agent is allowed to access. */
  allowedProjectPaths: string[];
  /**
   * Agent's spawn CWD (per-agent sandbox dir). Used to resolve relative path tokens
   * in Bash commands so checks happen against the agent's actual working directory,
   * not the Electron main process's cwd.
   */
  agentCwd: string;
};

export type GateDecision =
  | { action: "allow"; reason?: string }
  | { action: "deny"; reason: string }
  | { action: "request_user"; reason: string };

const FS_TOOLS = new Set(["Read", "Write", "Edit", "Glob", "Grep", "MultiEdit", "NotebookEdit"]);

const expandHome = (p: string): string =>
  p.startsWith("~/") || p === "~" ? p.replace(/^~/, homedir()) : p;

// Tokenize a shell command, respecting single- and double-quoted strings so
// paths with spaces stay intact (e.g. `ls "D:\My Folder\sub"` → one token, not
// three). A naïve whitespace split lets agents bypass the gate by quoting
// absolute paths.
const tokenizeShell = (cmd: string): string[] => {
  const tokens: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    while (i < cmd.length && /[\s;|&]/.test(cmd[i] as string)) i++;
    if (i >= cmd.length) break;
    let token = "";
    while (i < cmd.length && !/[\s;|&]/.test(cmd[i] as string)) {
      const c = cmd[i] as string;
      if (c === '"' || c === "'") {
        const quote = c;
        i++;
        while (i < cmd.length && cmd[i] !== quote) {
          token += cmd[i];
          i++;
        }
        if (i < cmd.length) i++;
      } else {
        token += c;
        i++;
      }
    }
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
};

const extractPathLikeTokens = (cmd: string): string[] => {
  return tokenizeShell(cmd).filter(
    (t) =>
      t.startsWith("/") || t.startsWith("~") || t.startsWith("..") || /^[A-Za-z]:[\\/]/.test(t),
  );
};

const isInsideAnyAllowed = (path: string, allowed: string[], cwd: string): boolean => {
  if (allowed.length === 0) return false;
  // Resolve relative paths against the agent's CWD, not the host process's cwd.
  const abs = resolve(cwd, expandHome(path));
  return allowed.some((root) => {
    const rootAbs = resolve(root);
    return abs === rootAbs || abs.startsWith(rootAbs + (process.platform === "win32" ? "\\" : "/"));
  });
};

const asObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};

export const evaluatePermission = (input: GateInput): GateDecision => {
  const { toolName, toolInput, agent, allowedProjectPaths, agentCwd } = input;
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
      if (!isInsideAnyAllowed(expanded, allowedProjectPaths, agentCwd)) {
        // Deny outright: the agent has no business touching paths outside its
        // allowedProjects. Use request_user only for the always-blocked case
        // above (so the operator can still override sensitive-file ops with
        // explicit consent).
        return { action: "deny", reason: `bash path outside any allowed project: ${tok}` };
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
      const abs = resolve(agentCwd, expanded);
      if (!isInsideAnyAllowed(abs, allowedProjectPaths, agentCwd)) {
        return { action: "deny", reason: "path outside allowed projects" };
      }
    }
  }

  if (agent.mode === "auto") {
    return { action: "allow" };
  }

  return { action: "request_user", reason: "supervised mode" };
};
