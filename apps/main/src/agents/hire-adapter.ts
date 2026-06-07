import type { AdapterName, AuthMode } from "@prospero/shared";

/**
 * Picks the adapter for a newly hired agent. Remote always forces OAuth — there
 * is no API-key remote adapter (design §7.3). Local follows the global auth mode.
 * In api-key mode, the CEO gets the `claude-api-direct` adapter (direct SDK call
 * with full context window); all other local agents use `claude-api-key-local`.
 */
export const pickAdapterForHire = (
  location: "local" | "remote" | undefined,
  authMode: AuthMode,
  opts: { isCeo?: boolean } = {},
): AdapterName => {
  if (location === "remote") return "claude-oauth-remote-docker";
  if (authMode === "api-key")
    return opts.isCeo === true ? "claude-api-direct" : "claude-api-key-local";
  return "claude-oauth-local";
};
