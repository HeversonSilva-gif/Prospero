/** Decrypted credentials passed to an agent adapter's SpawnContext. */
export type AdapterCredentials = { oauthToken?: string; apiKey?: string };

/** Loaders the resolver calls to fetch decrypted secrets (db-backed in prod). */
export type CredentialLoaders = {
  loadOauthToken: () => string | null;
  loadApiKey: () => string | null;
};

/**
 * Maps an adapter name to the credential it needs. Both OAuth adapters — local
 * and remote-docker — require the OAuth token; the API-key adapter requires the
 * API key. Throws for an unknown adapter or a missing credential.
 */
export const resolveAdapterCredentials = (
  adapterName: string,
  loaders: CredentialLoaders,
): AdapterCredentials => {
  if (adapterName === "claude-oauth-local" || adapterName === "claude-oauth-remote-docker") {
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
