import type { Agent } from "./agent.js";

export type AdapterName =
  | "claude-oauth-local"
  | "claude-api-key-local"
  | "claude-oauth-remote-docker";

export const DEFAULT_ADAPTER_NAME: AdapterName = "claude-oauth-local";

export type SpawnContext = {
  agent: Agent;
  oauthToken: string;
  dbPath: string;
  permissionsDir: string;
  eventsDir: string;
  userDataDir?: string;
  mcpServerJsPath?: string;
  cwd?: string;
};

export type AssistantContentBlock =
  | { kind: "text"; text: string }
  | { kind: "tool-use"; id: string; name: string; input: unknown };

export type ParsedEvent =
  | { kind: "session-init"; sessionId: string }
  | { kind: "assistant-message"; blocks: AssistantContentBlock[] }
  | { kind: "tool-result"; toolUseId: string; content: string; isError: boolean }
  | { kind: "turn-complete"; usage?: UsageEstimate; model?: string }
  | { kind: "api-retry"; attempt: number; error: string }
  | { kind: "unknown"; raw: unknown };

export type UsageEstimate = {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
};

export type AdapterEventListener<T> = (value: T) => void;

export interface AgentAdapter {
  readonly name: AdapterName;
  readonly agentId: string;
  start(): Promise<void>;
  sendInput(text: string): void;
  onEvent(cb: AdapterEventListener<ParsedEvent>): () => void;
  onStderr(cb: AdapterEventListener<string>): () => void;
  onExit(cb: AdapterEventListener<number | null>): () => void;
  kill(): void;
  isAlive(): boolean;
  getUsage(): UsageEstimate;
  getCurrentAction(): string | null;
}

export interface AgentAdapterFactory {
  readonly name: AdapterName;
  create(ctx: SpawnContext): AgentAdapter;
}
