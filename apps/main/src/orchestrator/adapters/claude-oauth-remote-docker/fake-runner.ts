import { WireServer, WIRE_PROTOCOL_VERSION, type WireTransport } from "@prospero/shared";

/**
 * A test-controllable agent-runner: a real WireServer with canned request
 * handlers, so connection-manager tests exercise the genuine wire codec and
 * framing without depending on the apps/agent-runner package. The test pushes
 * stdout/stderr/exit/mcp-* notifications by hand. Test-only.
 */
export class FakeRunner {
  readonly server: WireServer;
  /** agentIds passed to spawn, in order. */
  readonly spawned: string[] = [];
  /** stdin-write request params, in order. */
  readonly stdinWrites: { agentId: string; line: string }[] = [];
  /** agentIds passed to kill, in order. */
  readonly killed: string[] = [];
  /** host -> runner mcp-data notifications received, in order. */
  readonly mcpDataFromHost: { agentId: string; line: string }[] = [];
  /** Tests set this before connecting to force a handshake protocol mismatch. */
  handshakeProtocolVersion: number = WIRE_PROTOCOL_VERSION;
  private nextPid = 1000;

  constructor(transport: WireTransport) {
    this.server = new WireServer(transport);
    this.server.handle("handshake", () => ({
      protocolVersion: this.handshakeProtocolVersion,
      server: "fake-runner",
      serverVersion: "0",
      capabilities: ["spawn", "stdin", "kill", "health"],
    }));
    this.server.handle("spawn", (params) => {
      this.spawned.push((params as { agentId: string }).agentId);
      return { pid: this.nextPid++ };
    });
    this.server.handle("stdin-write", (params) => {
      this.stdinWrites.push(params as { agentId: string; line: string });
      return {};
    });
    this.server.handle("kill", (params) => {
      this.killed.push((params as { agentId: string }).agentId);
      return {};
    });
    this.server.handle("health", () => ({
      ok: true,
      uptimeSeconds: 1,
      activeAgents: this.spawned.length,
    }));
    this.server.onNotification("mcp-data", (params) => {
      this.mcpDataFromHost.push(params as { agentId: string; line: string });
    });
  }

  emitStdout(agentId: string, line: string): void {
    this.server.notify("stdout", { agentId, line });
  }
  emitStderr(agentId: string, line: string): void {
    this.server.notify("stderr", { agentId, line });
  }
  emitExit(agentId: string, code: number | null): void {
    this.server.notify("exit", { agentId, code });
  }
  emitMcpOpen(agentId: string): void {
    this.server.notify("mcp-open", { agentId });
  }
  emitMcpData(agentId: string, line: string): void {
    this.server.notify("mcp-data", { agentId, line });
  }
  emitMcpClose(agentId: string): void {
    this.server.notify("mcp-close", { agentId });
  }
}
