import type { AnySpawnEnv } from "../env.js";

// Credential env vars that, if set on the HOST process, must NOT be inherited by
// a spawned child. The child gets exactly the credential our orchestration layer
// passes in `env` — never whatever the host operator happened to export. Keeping
// the list in one place so every spawn path (interactive adapters + derivation
// runner) strips the same vars.
export const HOST_CREDENTIAL_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;

// Returns a copy of `base` (defaults to process.env) with the host credential
// vars removed. Used as the inherited baseline for any child spawn.
export const stripHostCredentials = (base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = { ...base };
  for (const key of HOST_CREDENTIAL_VARS) {
    delete out[key];
  }
  return out;
};

// Merges the stripped host env with the spawn-specific env and the per-agent
// CLAUDE_CONFIG_DIR. The order of spreads matters: stripped host baseline first,
// then env (our orchestration vars + the intended credential), then
// CLAUDE_CONFIG_DIR (forces the sandbox dir regardless of host CLAUDE_CONFIG_DIR).
// Stripping the host baseline ensures a host-set credential can never leak into
// the child and override the intended one.
export const mergeSpawnEnv = (env: AnySpawnEnv, configDir: string): NodeJS.ProcessEnv => ({
  ...stripHostCredentials(),
  ...env,
  CLAUDE_CONFIG_DIR: configDir,
});
