import type { AnySpawnEnv } from "../env.js";

// Merges process.env with the spawn-specific env and the per-agent CLAUDE_CONFIG_DIR.
// Extracted so adapters can reuse the same merge logic. The order of spreads matters:
// process.env first (host baseline), then env (overrides with our orchestration vars),
// then CLAUDE_CONFIG_DIR (forces sandbox dir regardless of host CLAUDE_CONFIG_DIR).
export const mergeSpawnEnv = (env: AnySpawnEnv, configDir: string): NodeJS.ProcessEnv => ({
  ...process.env,
  ...env,
  CLAUDE_CONFIG_DIR: configDir,
});
