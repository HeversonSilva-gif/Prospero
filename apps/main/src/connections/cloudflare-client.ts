// Thin, electron-free client for the Cloudflare API v4. The HTTP fn is INJECTED so the
// module is unit-testable without a live call. D.1 needs only `getAccount` (to validate
// a pasted API token and read its account); D.2/D.3 deploy via Wrangler in MAIN, not via
// this client. The unit tests assert the request WE send; the live contract is the smoke
// test. The token is a Bearer credential and is NEVER logged.

export type CloudflareHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export class CloudflareApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

export type CloudflareAccount = { id: string; name: string };

const ACCOUNTS_URL = "https://api.cloudflare.com/client/v4/accounts";

// Lists accounts for the token — both validates it (200 + ≥1 account ⇒ the token
// authenticates and can read the account) and returns the account to deploy into.
export const getAccount = async (
  http: CloudflareHttp,
  token: string,
): Promise<CloudflareAccount> => {
  const res = await http(ACCOUNTS_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as {
    success?: boolean;
    result?: Array<{ id: string; name: string }>;
    errors?: Array<{ message?: string }>;
  };
  const first = data.result?.[0];
  if (res.status >= 400 || data.success !== true || first === undefined) {
    throw new CloudflareApiError(
      res.status,
      data.errors?.[0]?.message ?? `Cloudflare API error ${String(res.status)}`,
    );
  }
  return { id: first.id, name: first.name };
};
