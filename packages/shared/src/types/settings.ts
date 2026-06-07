import type { AgentMode } from "./agent.js";

export type Language = "pt-BR" | "en-US";
export type Theme = "light" | "dark";

// Default Claude model id used when no per-agent override is set and no role
// template-level default applies. Sonnet 4.6 — best $/token for general use.
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

// Known preset model ids exposed in the Settings UI dropdown. Custom ids are
// also accepted (text input), validated against MODEL_ID_REGEX downstream.
export const CLAUDE_MODEL_PRESETS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

// Permitted characters in a Claude model id. Prevents command injection when
// the id is shell-spawned with --model. claude.com model ids match this shape.
export const MODEL_ID_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export type ExecutorMode = "atomic" | "narrated";

export type AuthMode = "oauth" | "api-key";

export type RemoteExecutionMode = "local-docker" | "remote-vps";

export type RemoteExecutionSettings = {
  enabled: boolean;
  mode: RemoteExecutionMode;
  vpsHost: string;
  vpsUser: string;
  vpsKeyPath: string;
};

export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;
  defaultModelForNewAgents: string;
  executorMode: ExecutorMode;
  activeCompanyId: string | null;
  authMode: AuthMode;
  defaultAgentMode: AgentMode;
  defaultAlwaysOn: boolean;
  derivationsPerDayPerAgent: number;
  compactionCacheReadThreshold: number;
  // Epoch ms until which the Max account is rate-limited; the team auto-resumes after. null = not limited.
  rateLimitedUntil: number | null;
  // Global kill-switch for the autonomous loop. When true, the reconciler does
  // NOT wake the team on its own — so just opening the app costs nothing. Forced
  // true on every launch (open paused); the user presses "Ativar" to run. Manual
  // actions (genesis, chatting with an agent) are NOT gated by this.
  autonomyPaused: boolean;
  remoteExecution: RemoteExecutionSettings;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
  defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
  executorMode: "atomic",
  activeCompanyId: null,
  authMode: "oauth",
  defaultAgentMode: "supervised",
  defaultAlwaysOn: false,
  derivationsPerDayPerAgent: 3,
  compactionCacheReadThreshold: 75_000,
  rateLimitedUntil: null,
  autonomyPaused: true,
  remoteExecution: {
    enabled: false,
    mode: "local-docker",
    vpsHost: "",
    vpsUser: "",
    vpsKeyPath: "",
  },
};
