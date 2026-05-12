// Foundation for M9 dual-auth selection. M9 will expand this to read from
// settings.json (e.g. { auth: { mode: 'api-key', apiKey: '...' } }) and
// return 'api-key' when configured. Centralised here so M9 doesn't sprinkle
// if-else across orchestrator + UI.

export type AuthMode = "oauth" | "api-key";

export const getActiveAuthMode = (): AuthMode => "oauth";
