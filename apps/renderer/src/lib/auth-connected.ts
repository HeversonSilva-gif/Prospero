import type { AuthMode } from "@prospero/shared";

/**
 * Whether the app is authenticated enough to run agents and load the user's data,
 * given the active auth mode. The readiness gate (App.tsx) and the onboarding
 * wizard must use THIS — not a bare `status.hasToken` — otherwise api-key mode
 * looks permanently unauthenticated: companies never load, `appReady` stays false,
 * and every route funnels back to the connection screen.
 *
 * Each mode checks its OWN credential: api-key mode needs a saved key (the OAuth
 * token is irrelevant there), oauth mode needs the OAuth token. Keeping it tied to
 * `authMode` (rather than `hasToken || hasKey`) means the gate matches the adapter
 * that will actually spawn — see orchestrator hire-adapter / adapter-migration.
 */
export const isAuthConnected = (
  authMode: AuthMode,
  tokenStatus: { hasToken: boolean },
  apiKeyStatus: { hasKey: boolean },
): boolean => (authMode === "api-key" ? apiKeyStatus.hasKey : tokenStatus.hasToken);
