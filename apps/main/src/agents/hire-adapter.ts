import type { AdapterName, AuthMode } from "@prospero/shared";

/**
 * Picks the adapter for a newly hired agent. Remote always forces OAuth — there
 * is no API-key remote adapter (design §7.3). Local follows the global auth mode.
 */
export const pickAdapterForHire = (
  location: "local" | "remote" | undefined,
  authMode: AuthMode,
): AdapterName => {
  if (location === "remote") return "claude-oauth-remote-docker";
  return authMode === "api-key" ? "claude-api-key-local" : "claude-oauth-local";
};
