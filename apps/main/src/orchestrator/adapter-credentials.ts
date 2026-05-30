/** Decrypted credentials passed to an agent adapter's SpawnContext. */
export type AdapterCredentials = { oauthToken?: string; apiKey?: string };

/** Loaders the resolver calls to fetch decrypted secrets (db-backed in prod). */
export type CredentialLoaders = {
  loadOauthToken: () => string | null;
  loadApiKey: () => string | null;
};

/**
 * Maps an adapter name to the credential it needs. The LOCAL OAuth adapter seeds
 * auth from the host's ~/.claude/.credentials.json file, so its DB token is only
 * an env fallback — OPTIONAL. The REMOTE-docker adapter has no host file to seed
 * from, so it REQUIRES the token. The API-key adapter requires the API key.
 * Throws for an unknown adapter or a required-but-missing credential.
 */
export const resolveAdapterCredentials = (
  adapterName: string,
  loaders: CredentialLoaders,
): AdapterCredentials => {
  if (adapterName === "claude-oauth-local") {
    // Optional: prepare-sandbox seeds the host credential file into the agent's
    // CLAUDE_CONFIG_DIR; the token here is only injected into the env when that
    // seed fails. Requiring it upfront stranded agents in `error` whenever the
    // user cleared the token in the UI despite a valid host login (2026-05-30).
    const token = loaders.loadOauthToken();
    return token === null ? {} : { oauthToken: token };
  }
  if (adapterName === "claude-oauth-remote-docker") {
    const token = loaders.loadOauthToken();
    if (token === null) throw new Error("OAuth token not configured");
    return { oauthToken: token };
  }
  if (adapterName === "claude-api-key-local") {
    const key = loaders.loadApiKey();
    if (key === null) throw new Error("API key not configured");
    return { apiKey: key };
  }
  throw new Error(`Unknown adapter '${adapterName}'`);
};
