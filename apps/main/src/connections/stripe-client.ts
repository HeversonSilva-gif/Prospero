// Thin, electron-free client for the Stripe REST API. The HTTP fn is INJECTED so the
// module is unit-testable without a live call. P5.1 needs only `getAccount` (to
// validate a pasted restricted key and read its display name); P5.2/P5.3 extend this
// file with product/price/payment-link/charges/balance. The unit tests assert the
// request WE send; the live contract is confirmed in the smoke test.

export type StripeHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

// Pure check of the pasted key's shape. We require a RESTRICTED key (rk_…) for the
// money rail and derive test/live from the prefix — never store a full secret key.
export type StripeKeyCheck = { ok: true; livemode: boolean } | { ok: false; error: string };

export const validateStripeKeyShape = (key: string): StripeKeyCheck => {
  const k = key.trim();
  if (k.startsWith("rk_live_")) return { ok: true, livemode: true };
  if (k.startsWith("rk_test_")) return { ok: true, livemode: false };
  if (k.startsWith("pk_"))
    return { ok: false, error: "Isso é uma chave publicável. Use uma chave restrita (rk_…)." };
  if (k.startsWith("sk_"))
    return { ok: false, error: "Use uma chave restrita (rk_…), não a chave secreta completa." };
  return { ok: false, error: "Chave Stripe inválida. Cole uma chave restrita (rk_…)." };
};

export type StripeAccount = { id: string; displayName: string; email?: string; country?: string };

const ACCOUNT_URL = "https://api.stripe.com/v1/account";

// Reads the account behind the key — used to validate the connection and show a name.
export const getAccount = async (http: StripeHttp, key: string): Promise<StripeAccount> => {
  const res = await http(ACCOUNT_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = (await res.json()) as {
    id?: string;
    email?: string;
    country?: string;
    business_profile?: { name?: string | null };
    settings?: { dashboard?: { display_name?: string | null } };
    error?: { message?: string };
  };
  if (res.status >= 400 || data.id === undefined) {
    throw new StripeApiError(
      res.status,
      data.error?.message ?? `Stripe API error ${String(res.status)}`,
    );
  }
  const displayName =
    data.settings?.dashboard?.display_name ?? data.business_profile?.name ?? data.email ?? data.id;
  return {
    id: data.id,
    displayName,
    ...(data.email !== undefined ? { email: data.email } : {}),
    ...(data.country !== undefined ? { country: data.country } : {}),
  };
};
