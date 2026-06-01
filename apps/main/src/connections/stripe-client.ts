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

// --- P5.2: money-setup endpoints (called from MAIN, behind the approval gate) ---

const FORM_CT = "application/x-www-form-urlencoded";

const postHeaders = (key: string): Record<string, string> => ({
  Authorization: `Bearer ${key}`,
  "Content-Type": FORM_CT,
});

const encodeForm = (params: Record<string, string | number>): string =>
  Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

const expectId = (data: { id?: string; error?: { message?: string } }, status: number): string => {
  if (status >= 400 || data.id === undefined) {
    throw new StripeApiError(status, data.error?.message ?? `Stripe API error ${String(status)}`);
  }
  return data.id;
};

export const createProduct = async (
  http: StripeHttp,
  key: string,
  input: { name: string; description: string },
): Promise<{ id: string }> => {
  const res = await http("https://api.stripe.com/v1/products", {
    method: "POST",
    headers: postHeaders(key),
    body: encodeForm({ name: input.name, description: input.description }),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  return { id: expectId(data, res.status) };
};

export const createPrice = async (
  http: StripeHttp,
  key: string,
  input: { product: string; unitAmount: number; currency: string; interval?: "month" | "year" },
): Promise<{ id: string }> => {
  const params: Record<string, string | number> = {
    product: input.product,
    unit_amount: input.unitAmount,
    currency: input.currency,
  };
  if (input.interval !== undefined) params["recurring[interval]"] = input.interval;
  const res = await http("https://api.stripe.com/v1/prices", {
    method: "POST",
    headers: postHeaders(key),
    body: encodeForm(params),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  return { id: expectId(data, res.status) };
};

export const createPaymentLink = async (
  http: StripeHttp,
  key: string,
  input: { lineItems: { price: string; quantity: number }[] },
): Promise<{ id: string; url: string }> => {
  const params: Record<string, string | number> = {};
  input.lineItems.forEach((li, i) => {
    params[`line_items[${i}][price]`] = li.price;
    params[`line_items[${i}][quantity]`] = li.quantity;
  });
  const res = await http("https://api.stripe.com/v1/payment_links", {
    method: "POST",
    headers: postHeaders(key),
    body: encodeForm(params),
  });
  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  const id = expectId(data, res.status);
  if (data.url === undefined) {
    throw new StripeApiError(res.status, "Stripe payment link missing url");
  }
  return { id, url: data.url };
};

// --- P5.3: read endpoints for sensing the sale (called from MAIN) ---

export type StripeCharge = {
  id: string;
  amount: number;
  currency: string;
  created: number; // ms (Stripe returns seconds; we convert)
  status: string;
};

export const listCharges = async (
  http: StripeHttp,
  key: string,
  opts: { createdGte?: number; limit?: number } = {},
): Promise<StripeCharge[]> => {
  const params = [`limit=${String(opts.limit ?? 100)}`];
  if (opts.createdGte !== undefined) {
    // Stripe wants `created[gte]` in seconds; encode the brackets for the query.
    params.push(`created%5Bgte%5D=${String(Math.floor(opts.createdGte / 1000))}`);
  }
  const res = await http(`https://api.stripe.com/v1/charges?${params.join("&")}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = (await res.json()) as {
    data?: Array<{ id: string; amount: number; currency: string; created: number; status: string }>;
    error?: { message?: string };
  };
  if (res.status >= 400) {
    throw new StripeApiError(
      res.status,
      data.error?.message ?? `Stripe API error ${String(res.status)}`,
    );
  }
  return (data.data ?? []).map((c) => ({
    id: c.id,
    amount: c.amount,
    currency: c.currency,
    created: c.created * 1000,
    status: c.status,
  }));
};
