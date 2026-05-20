import { resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { Agent } from "@prospero/shared";
import { matchesBlockedBash, matchesBlockedPath } from "./blocklist.js";
import { zoneOf, canAccess, type ZoneId } from "./zones.js";
import { tryGetRecorder } from "../activity/index.js";
import { tryGetInbox } from "../inbox/index.js";
import { broadcastInboxUpdate } from "../ipc/inbox-handlers.js";

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
  /**
   * Absolute path of Electron's userData directory. Consumed by the M13 PR-E
   * containment-zone check to classify FS-tool paths into company/agent zones.
   */
  userDataDir: string;
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

// M13 PR-E containment zones: derive a short reason string from the zone +
// actor combination, audit the deny via the activity stream, and return a
// deny decision. Called from inside the FS-tool branch right after the
// path-fence accepted the path.
const buildZoneReason = (
  zone: ZoneId,
  actor: { companyId: string; id: string },
): "cross-company" | "cross-agent" | "system" | "denied" => {
  if (zone.kind === "company" && zone.companyId !== actor.companyId) return "cross-company";
  if (zone.kind === "agent" && (zone.companyId !== actor.companyId || zone.agentId !== actor.id)) {
    return "cross-agent";
  }
  if (zone.kind === "system") return "system";
  return "denied";
};

const auditZoneBlocked = (agent: Agent, absPath: string, zone: ZoneId, reason: string): void => {
  try {
    tryGetRecorder()?.recordActivity({
      companyId: agent.companyId,
      actor: { kind: "agent", id: agent.id },
      action: "security.zone_blocked",
      entityKind: "agent",
      entityId: agent.id,
      agentId: agent.id,
      payload: {
        attemptedPath: absPath,
        zoneKind: zone.kind,
        reason,
      },
    });
  } catch (err) {
    // Defensive: an audit-record failure must never break the gate's deny
    // path. Log and continue — the deny still applies.
    console.warn("[gate] failed to record security.zone_blocked", err);
  }

  // M13 PR-F: also surface the deny as an informational inbox card so the
  // operator can notice without digging through the activity stream. De-dup
  // within a 5-minute window to keep agent loops from spamming the inbox.
  try {
    const inbox = tryGetInbox();
    if (inbox === undefined) return;
    const recent = inbox.findRecentUnread({
      companyId: agent.companyId,
      agentId: agent.id,
      kind: "security_zone_blocked",
      withinMs: 5 * 60 * 1000,
    });
    if (recent !== null) return; // de-dup
    inbox.create({
      companyId: agent.companyId,
      kind: "security_zone_blocked",
      actorId: agent.id,
      title: `Zone block: ${reason}`,
      preview: absPath.slice(-120),
      requiresAction: false,
      payloadJson: JSON.stringify({ attemptedPath: absPath, zoneKind: zone.kind, reason }),
    });
    // Notify renderer so the inbox badge updates immediately. BrowserWindow is
    // undefined when this runs outside an Electron host (unit tests) — the
    // throw is swallowed by the surrounding try/catch.
    broadcastInboxUpdate(agent.companyId);
  } catch (err) {
    console.warn("[gate] failed to create zone_blocked inbox card", err);
  }
};

export const evaluatePermission = (input: GateInput): GateDecision => {
  const { toolName, toolInput, agent, allowedProjectPaths, agentCwd, userDataDir } = input;
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
      // M13 PR-E containment zones. Defense-in-depth: the path-fence already
      // accepted this path, but if it falls inside a known zone the actor
      // cannot access (a different company / a different agent / system),
      // deny + audit. Unknown zones (zoneOf returns null) defer to the
      // path-fence — no opinion.
      const zone = zoneOf(abs, userDataDir);
      if (zone !== null && !canAccess(agent, zone)) {
        const reason = buildZoneReason(zone, agent);
        auditZoneBlocked(agent, abs, zone, reason);
        return { action: "deny", reason: `zone_blocked: ${reason}` };
      }
    }
  }

  if (agent.mode === "auto") {
    return { action: "allow" };
  }

  return { action: "request_user", reason: "supervised mode" };
};
