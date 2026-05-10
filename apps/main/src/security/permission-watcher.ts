import chokidar, { type FSWatcher } from "chokidar";
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { PermissionResolution } from "@dashboard-agent/shared";
import type { Agent, PermissionRequest } from "@dashboard-agent/shared";
import { evaluatePermission } from "./gate.js";

export type WatcherOptions = {
  dir: string;
  getAgent: (agentId: string) => Agent | null;
  /** Returns the list of allowed project root paths for the given agent. */
  getAllowedProjectPaths: (agentId: string) => string[];
  onUserDecision: (request: PermissionRequest, reason: string) => void;
  onResolved?: (toolUseId: string, resolution: PermissionResolution) => void;
};

const safeUnlink = (p: string): void => {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best effort */
  }
};

const cleanupOrphans = (dir: string): void => {
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".req.json")) safeUnlink(join(dir, f));
  }
};

export const startPermissionWatcher = (opts: WatcherOptions): (() => Promise<void>) => {
  cleanupOrphans(opts.dir);

  const handle = (filePath: string): void => {
    const name = basename(filePath);
    if (!name.endsWith(".req.json")) return;
    let body: { tool_use_id: string; agentId: string; tool_name: string; tool_input: unknown };
    try {
      body = JSON.parse(readFileSync(filePath, "utf8")) as typeof body;
    } catch {
      return;
    }
    const agent = opts.getAgent(body.agentId);
    if (agent === null) {
      writeFileSync(
        join(opts.dir, `${body.tool_use_id}.deny.json`),
        JSON.stringify({ behavior: "deny", message: "agent not found" }),
      );
      return;
    }
    const decision = evaluatePermission({
      toolName: body.tool_name,
      toolInput: body.tool_input,
      agent,
      allowedProjectPaths: opts.getAllowedProjectPaths(body.agentId),
    });
    if (decision.action === "allow") {
      writeFileSync(
        join(opts.dir, `${body.tool_use_id}.res.json`),
        JSON.stringify({ behavior: "allow" }),
      );
    } else if (decision.action === "deny") {
      writeFileSync(
        join(opts.dir, `${body.tool_use_id}.deny.json`),
        JSON.stringify({ behavior: "deny", message: decision.reason }),
      );
    } else {
      opts.onUserDecision(
        {
          toolUseId: body.tool_use_id,
          agentId: body.agentId,
          toolName: body.tool_name,
          toolInput: body.tool_input,
        },
        decision.reason,
      );
    }
  };

  const handleResolution = (filePath: string): void => {
    if (opts.onResolved === undefined) return;
    const name = basename(filePath);
    const m = /^(.+)\.(res|deny)\.json$/.exec(name);
    if (m === null) return;
    try {
      const body = JSON.parse(readFileSync(filePath, "utf8")) as PermissionResolution;
      opts.onResolved(m[1] ?? "", body);
    } catch {
      /* best effort */
    }
  };

  const watcher: FSWatcher = chokidar.watch(opts.dir, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
  });
  watcher.on("add", (p) => {
    handle(p);
    handleResolution(p);
  });

  return async () => {
    await watcher.close();
  };
};
