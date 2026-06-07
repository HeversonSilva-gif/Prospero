import type { AdapterName, AuthMode } from "@prospero/shared";

const LOCAL_OAUTH: AdapterName = "claude-oauth-local";
const LOCAL_API_KEY: AdapterName = "claude-api-key-local";

/**
 * Given an agent's CURRENT adapter and the NEW auth mode, returns the adapter it
 * should switch to — or `null` when nothing should change.
 *
 * Only the LOCAL pair flips (`claude-oauth-local` ↔ `claude-api-key-local`).
 * `claude-oauth-remote-docker` is a different axis (location=remote, picked at
 * hire time regardless of authMode — see hire-adapter.ts) and is deliberately
 * left untouched: re-pointing a remote agent to a local adapter would break it.
 */
export const nextAdapterForAuthMode = (current: string, mode: AuthMode): AdapterName | null => {
  if (mode === "api-key") {
    return current === LOCAL_OAUTH ? LOCAL_API_KEY : null;
  }
  return current === LOCAL_API_KEY ? LOCAL_OAUTH : null;
};

/** Minimal agent shape the migration needs (decoupled from the full Agent type). */
export type MigrationAgent = { id: string; adapterName: string; status: string };

export type MigrateDeps = {
  authMode: AuthMode;
  /** Whether a decrypted API key is available — gates the switch TO api-key. */
  hasApiKey: boolean;
  listAgents: () => MigrationAgent[];
  setAdapterName: (id: string, name: AdapterName) => void;
  /** True when the agent has a LIVE adapter process right now. */
  isRunning: (id: string) => boolean;
  /** Kill the live adapter before respawning it on the new credential. */
  kill: (id: string) => void;
  respawn: (id: string) => Promise<unknown>;
  log?: (msg: string) => void;
};

export type MigrationResult = {
  /** Agents whose stored adapter_name was re-pointed. */
  migrated: string[];
  /** Subset of `migrated` that were live and were killed + respawned now. */
  respawned: string[];
  /** Set when the whole migration was skipped, with the reason. */
  skipped: "no-api-key" | null;
};

/**
 * Re-points every existing local agent's adapter to match `authMode`, so flipping
 * the auth mode in Settings doesn't require re-hiring the team. Live agents are
 * killed + respawned immediately (the respawn resolves the correct credential via
 * resolveAdapterCredentials — see respawn.ts); idle agents adopt the new adapter
 * on their next natural spawn.
 *
 * GUARD: switching agents to the api-key adapter with no saved key would strand
 * them in `error` (resolveAdapterCredentials throws "API key not configured").
 * In that case the migration is skipped — the AUTH_API_KEY_SET handler re-runs it
 * once a key lands, which is the real UI order (flip mode → then paste key).
 */
export const migrateAgentsForAuthMode = async (deps: MigrateDeps): Promise<MigrationResult> => {
  if (deps.authMode === "api-key" && !deps.hasApiKey) {
    deps.log?.("adapter-migration: skipped — api-key mode but no key saved yet");
    return { migrated: [], respawned: [], skipped: "no-api-key" };
  }

  const migrated: string[] = [];
  const respawned: string[] = [];

  for (const agent of deps.listAgents()) {
    if (agent.status === "terminated") continue; // gone — never spawns again
    const target = nextAdapterForAuthMode(agent.adapterName, deps.authMode);
    if (target === null) continue; // already correct, or remote-docker (untouched)

    deps.setAdapterName(agent.id, target);
    migrated.push(agent.id);

    // Respawn only LIVE agents so they pick up the new credential now. Idle
    // agents have no live process; their next spawn reads the new adapter_name.
    if (deps.isRunning(agent.id)) {
      deps.kill(agent.id);
      try {
        await deps.respawn(agent.id);
        respawned.push(agent.id);
      } catch (e) {
        // A single failed respawn must not abort the rest of the migration.
        deps.log?.(
          `adapter-migration: respawn failed for ${agent.id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  deps.log?.(
    `adapter-migration: mode=${deps.authMode} migrated=${migrated.length.toString()} respawned=${respawned.length.toString()}`,
  );
  return { migrated, respawned, skipped: null };
};

// --- Injected runner -------------------------------------------------------
// The migration needs the orchestrator's respawn fn + live-adapter registry,
// which live in orchestrator-handlers.ts. Mirroring credential-recovery.ts, the
// orchestrator injects a runner once at init; auth-handlers.ts (AUTH_API_KEY_SET)
// and the AUTH_SET_MODE handler both call runAdapterMigration without importing
// electron/orchestrator internals. No runner wired (tests, headless) → no-op.

type MigrationRunner = (mode: AuthMode) => Promise<MigrationResult>;
let runner: MigrationRunner | null = null;

export const setAdapterMigrationRunner = (fn: MigrationRunner | null): void => {
  runner = fn;
};

export const runAdapterMigration = async (mode: AuthMode): Promise<MigrationResult> => {
  if (runner === null) return { migrated: [], respawned: [], skipped: null };
  return runner(mode);
};

export const __resetAdapterMigration = (): void => {
  runner = null;
};
