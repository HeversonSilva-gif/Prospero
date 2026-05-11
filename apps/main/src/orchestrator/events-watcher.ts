import chokidar, { type FSWatcher } from "chokidar";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";

export type AgentEvent = {
  kind: string;
  agentId: string;
  companyId: string;
  payload?: unknown;
};

export type EventsWatcherOptions = {
  dir: string;
  onEvent: (event: AgentEvent) => void;
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
    if (f.endsWith(".json")) safeUnlink(join(dir, f));
  }
};

export const startEventsWatcher = (opts: EventsWatcherOptions): (() => Promise<void>) => {
  cleanupOrphans(opts.dir);

  const handle = (filePath: string): void => {
    const name = basename(filePath);
    if (!name.endsWith(".json")) return;
    let body: AgentEvent;
    try {
      body = JSON.parse(readFileSync(filePath, "utf8")) as AgentEvent;
    } catch {
      safeUnlink(filePath);
      return;
    }
    safeUnlink(filePath);
    if (typeof body.kind !== "string" || typeof body.agentId !== "string") return;
    try {
      opts.onEvent(body);
    } catch (e) {
      console.error(`[events-watcher] onEvent threw: ${(e as Error).message}`);
    }
  };

  const watcher: FSWatcher = chokidar.watch(opts.dir, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 15 },
  });
  watcher.on("add", handle);

  return async () => {
    await watcher.close();
  };
};
