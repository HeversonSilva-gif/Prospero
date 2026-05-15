// Wire protocol shared between the orchestrator (apps/main) and the remote
// agent-runner (apps/agent-runner). Types + plain runtime constants only — no
// zod (packages/shared is bundled into the preload sandbox; each app adds its
// own zod validation). See docs/m10-adapter-wire-protocol.md.

export const WIRE_PROTOCOL_VERSION = 1;

/** Error codes returned in WireResponse.error. */
export const WireErrorCode = {
  unsupportedProtocol: 1000,
  unsupportedCredentials: 1001,
  agentNotFound: 1010,
  spawnFailed: 1020,
  protocolMismatch: 1030,
  unauthorised: 1040,
  internalError: 1090,
} as const;
export type WireErrorCode = (typeof WireErrorCode)[keyof typeof WireErrorCode];

/** Method names. Requests go host→runner; notifications cross both ways. */
export const WireMethod = {
  handshake: "handshake",
  spawn: "spawn",
  stdinWrite: "stdin-write",
  kill: "kill",
  health: "health",
  stdout: "stdout",
  stderr: "stderr",
  exit: "exit",
  mcpOpen: "mcp-open",
  mcpData: "mcp-data",
  mcpClose: "mcp-close",
} as const;
export type WireMethod = (typeof WireMethod)[keyof typeof WireMethod];

export type WireError = { code: number; message: string };

// --- Envelope --------------------------------------------------------------

export type WireRequest = {
  type: "request";
  id: string;
  method: string;
  params?: unknown;
};
export type WireResponse = {
  type: "response";
  id: string;
  result?: unknown;
  error?: WireError;
};
export type WireNotification = {
  type: "notification";
  method: string;
  params?: unknown;
};
export type WireMessage = WireRequest | WireResponse | WireNotification;

// --- Credentials -----------------------------------------------------------

export type WireCredentials = { kind: "oauth"; oauthToken: string };

// --- Request params / results ----------------------------------------------

export type HandshakeParams = {
  protocolVersion: number;
  client: string;
  clientVersion: string;
  credentials: WireCredentials;
};
export type HandshakeResult = {
  protocolVersion: number;
  server: string;
  serverVersion: string;
  capabilities: string[];
};

export type SpawnParams = {
  agentId: string;
  /** claude argv built host-side by buildClaudeArgs, minus the MCP triplet. */
  args: string[];
  /** Extra env for the claude child (e.g. ANTHROPIC_API_URL). Usually empty. */
  env?: Record<string, string>;
};
export type SpawnResult = { pid: number };

export type StdinWriteParams = { agentId: string; line: string };

export type KillParams = { agentId: string };

export type HealthResult = {
  ok: boolean;
  uptimeSeconds: number;
  activeAgents: number;
};

// --- Notification params ---------------------------------------------------

export type StdoutNotification = { agentId: string; line: string };
export type StderrNotification = { agentId: string; line: string };
export type ExitNotification = { agentId: string; code: number | null };
export type McpOpenNotification = { agentId: string };
export type McpDataNotification = { agentId: string; line: string };
export type McpCloseNotification = { agentId: string };
