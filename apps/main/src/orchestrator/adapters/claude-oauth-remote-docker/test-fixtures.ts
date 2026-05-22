import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Agent, SpawnContext } from "@prospero/shared";
import type { McpServerProcess } from "./mcp-relay.js";

/**
 * A test-controllable host MCP server process. The test drives stdout and
 * inspects what the relay wrote to stdin. Test-only.
 */
export class FakeMcpServer extends EventEmitter implements McpServerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  killed = false;
  /** Every chunk the relay wrote to stdin, in order. */
  readonly stdinWrites: string[] = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => this.stdinWrites.push(chunk.toString()));
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.emit("exit", 0);
  }

  /** Test helper: push a chunk to the server's stdout. */
  emitStdout(chunk: string): void {
    this.stdout.write(chunk);
  }
}

const baseAgent: Agent = {
  id: "agent_1",
  companyId: "co_1",
  name: "Engineer",
  role: "Backend Engineer",
  systemPrompt: "You are an engineer.",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-remote-docker",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
  autoModeSetAt: null,
};

/** A minimal SpawnContext for remote-adapter tests. Test-only. */
export const makeSpawnContext = (overrides: Partial<SpawnContext> = {}): SpawnContext => ({
  agent: baseAgent,
  oauthToken: "test-oauth-token",
  dbPath: "/tmp/prospero-test.sqlite",
  permissionsDir: "/tmp/prospero-test-perms",
  eventsDir: "/tmp/prospero-test-events",
  mcpServerJsPath: "/fake/mcp/server.js",
  ...overrides,
});
