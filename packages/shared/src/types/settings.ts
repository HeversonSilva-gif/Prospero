export type Language = "pt-BR" | "en-US";
export type Theme = "light" | "dark";

// Default Claude model id used when no per-agent override is set and no role
// template-level default applies. Sonnet 4.6 — best $/token for general use.
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

// Known preset model ids exposed in the Settings UI dropdown. Custom ids are
// also accepted (text input), validated against MODEL_ID_REGEX downstream.
export const CLAUDE_MODEL_PRESETS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

// Permitted characters in a Claude model id. Prevents command injection when
// the id is shell-spawned with --model. claude.com model ids match this shape.
export const MODEL_ID_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export type ExecutorMode = "atomic" | "narrated";

export type AuthMode = "oauth" | "api-key";

export type AppSettings = {
  language: Language;
  theme: Theme;
  workspaceCwd: string | null;
  defaultModelForNewAgents: string;
  executorMode: ExecutorMode;
  activeCompanyId: string | null;
  authMode: AuthMode;
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "pt-BR",
  theme: "light",
  workspaceCwd: null,
  defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
  executorMode: "atomic",
  activeCompanyId: null,
  authMode: "oauth",
};
