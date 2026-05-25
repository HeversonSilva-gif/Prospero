import type { Agent } from "./agent.js";

export type AdapterName =
  | "claude-oauth-local"
  | "claude-api-key-local"
  | "claude-oauth-remote-docker";

export const DEFAULT_ADAPTER_NAME: AdapterName = "claude-oauth-local";

export type SpawnContext = {
  agent: Agent;
  oauthToken?: string;
  apiKey?: string;
  dbPath: string;
  permissionsDir: string;
  eventsDir: string;
  userDataDir?: string;
  mcpServerJsPath?: string;
  cwd?: string;
  // M8.6: when true, the narrated-execution system prompt block is injected
  // into the agent's system prompt. The host resolves this at spawn time by
  // checking goalsRepo.findActiveNarratedByCeo(agent.id).
  narratedActive?: boolean;
  // M11: pre-assembled memory & skills system-prompt block. The host builds it
  // at spawn time via buildMemoryBlock (it needs DB access build-args lacks).
  memoryBlock?: string;
  // M12 PR-C: pre-assembled instruction bundle (charter + extras), read from
  // the agent's on-disk bundle by the host at spawn time via composeInstructions.
  instructionsBlock?: string;
  // M13 PR-C: the company TELOS system-prompt block.
  telosBlock?: string;
  // feat/memoria-contexto-projeto: pre-assembled project context system-prompt block.
  projectContextBlock?: string;
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
  | { kind: "rate-limited"; resetsAt: number | null; retryAfterSec: number | null; message: string }
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
