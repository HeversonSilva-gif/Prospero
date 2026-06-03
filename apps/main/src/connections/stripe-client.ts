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

const postHeaders = (key: string, idempotencyKey?: string): Record<string, string> => ({
  Authorization: `Bearer ${key}`,
  "Content-Type": FORM_CT,
  // I6 (Conectores audit): a stable key lets Stripe dedupe a retried setup so a
  // re-run / deferred-approval re-attempt doesn't litter the account with duplicate
  // products/prices/links. Omitted entirely when absent (no empty header).
  ...(idempotencyKey !== undefined ? { "Idempotency-Key": idempotencyKey } : {}),
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
  idempotencyKey?: string,
): Promise<{ id: string }> => {
  const res = await http("https://api.stripe.com/v1/products", {
    method: "POST",
    headers: postHeaders(key, idempotencyKey),
    body: encodeForm({ name: input.name, description: input.description }),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  return { id: expectId(data, res.status) };
};

export const createPrice = async (
  http: StripeHttp,
  key: string,
  input: { product: string; unitAmount: number; currency: string; interval?: "month" | "year" },
  idempotencyKey?: string,
): Promise<{ id: string }> => {
  const params: Record<string, string | number> = {
    product: input.product,
    unit_amount: input.unitAmount,
    currency: input.currency,
  };
  if (input.interval !== undefined) params["recurring[interval]"] = input.interval;
  const res = await http("https://api.stripe.com/v1/prices", {
    method: "POST",
    headers: postHeaders(key, idempotencyKey),
    body: encodeForm(params),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  return { id: expectId(data, res.status) };
};

export const createPaymentLink = async (
  http: StripeHttp,
  key: string,
  input: { lineItems: { price: string; quantity: number }[] },
  idempotencyKey?: string,
): Promise<{ id: string; url: string }> => {
  const params: Record<string, string | number> = {};
  input.lineItems.forEach((li, i) => {
    params[`line_items[${i}][price]`] = li.price;
    params[`line_items[${i}][quantity]`] = li.quantity;
  });
  const res = await http("https://api.stripe.com/v1/payment_links", {
    method: "POST",
    headers: postHeaders(key, idempotencyKey),
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
  // I5 (Conectores audit): a refunded/disputed charge stays status:"succeeded".
  // amountRefunded is the smallest currency unit refunded; a dispute (chargeback) is
  // surfaced as a full refund so net revenue = amount - amountRefunded never overcounts.
  amountRefunded: number;
  disputed: boolean;
  customer: string | null;
};

// Max pages followed for any paginated list — a runaway backstop (100/page × 50 = 5000).
const MAX_PAGES = 50;

export const listCharges = async (
  http: StripeHttp,
  key: string,
  opts: { createdGte?: number; limit?: number } = {},
): Promise<StripeCharge[]> => {
  const limit = opts.limit ?? 100;
  const out: StripeCharge[] = [];
  let startingAfter: string | undefined;
  // Follow Stripe's `has_more`/`starting_after` cursor — a busy company can have far
  // more than one page of charges in the window; truncating at 100 silently undercounts
  // revenue exactly when the business is succeeding.
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = [`limit=${String(limit)}`];
    if (opts.createdGte !== undefined) {
      // Stripe wants `created[gte]` in seconds; encode the brackets for the query.
      params.push(`created%5Bgte%5D=${String(Math.floor(opts.createdGte / 1000))}`);
    }
    if (startingAfter !== undefined) params.push(`starting_after=${startingAfter}`);
    const res = await http(`https://api.stripe.com/v1/charges?${params.join("&")}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        amount: number;
        amount_refunded?: number;
        disputed?: boolean;
        customer?: string | null;
        currency: string;
        created: number;
        status: string;
      }>;
      has_more?: boolean;
      error?: { message?: string };
    };
    if (res.status >= 400) {
      throw new StripeApiError(
        res.status,
        data.error?.message ?? `Stripe API error ${String(res.status)}`,
      );
    }
    const rows = (data.data ?? []).map((c) => {
      const disputed = c.disputed === true;
      // A dispute removes the whole charge; record it as a full refund so net = 0.
      const amountRefunded = disputed ? c.amount : (c.amount_refunded ?? 0);
      return {
        id: c.id,
        amount: c.amount,
        currency: c.currency,
        created: c.created * 1000,
        status: c.status,
        amountRefunded,
        disputed,
        customer: typeof c.customer === "string" ? c.customer : null,
      };
    });
    out.push(...rows);
    const last = rows[rows.length - 1];
    if (data.has_more !== true || last === undefined) break;
    startingAfter = last.id;
  }
  return out;
};

// --- Finance panorama (v0.2.8): subscriptions feed MRR / churn / active customers ---

export type StripeSubscription = {
  id: string;
  customer: string | null;
  status: string;
  created: number; // ms
  canceledAt: number | null; // ms
  productId: string | null;
  productName: string | null;
  amount: number; // primary price, smallest currency unit, per interval
  currency: string;
  interval: string; // month | year | week | day
};

type RawSubItem = {
  price?: {
    unit_amount?: number | null;
    currency?: string;
    recurring?: { interval?: string } | null;
    product?: string | { id?: string; name?: string } | null;
  };
};

const mapSubscription = (s: {
  id: string;
  customer?: string | null;
  status: string;
  created: number;
  canceled_at?: number | null;
  items?: { data?: RawSubItem[] };
}): StripeSubscription => {
  const items = s.items?.data ?? [];
  const primary = items[0]?.price;
  const interval = primary?.recurring?.interval ?? "month";
  const currency = primary?.currency ?? "";
  // Sum every line item that shares the primary price's interval+currency so a
  // multi-item subscription (base plan + add-on) reports its FULL recurring amount, not
  // just the first line — otherwise MRR silently undercounts multi-item subs.
  const amount = items.reduce((sum, it) => {
    const p = it.price;
    if (p?.recurring?.interval === interval && p.currency === currency) {
      return sum + (p.unit_amount ?? 0);
    }
    return sum;
  }, 0);
  const product = primary?.product ?? null;
  const productId = typeof product === "string" ? product : (product?.id ?? null);
  const productName =
    typeof product === "object" && product !== null ? (product.name ?? null) : null;
  return {
    id: s.id,
    customer: typeof s.customer === "string" ? s.customer : null,
    status: s.status,
    created: s.created * 1000,
    canceledAt: typeof s.canceled_at === "number" ? s.canceled_at * 1000 : null,
    productId,
    productName,
    amount,
    currency,
    interval,
  };
};

export const listSubscriptions = async (
  http: StripeHttp,
  key: string,
  opts: { limit?: number } = {},
): Promise<StripeSubscription[]> => {
  const limit = opts.limit ?? 100;
  const out: StripeSubscription[] = [];
  let startingAfter: string | undefined;
  // status=all so we also see canceled subs (needed for churn). Expand the product so we
  // get its display name. Paginate so MRR/churn don't truncate at 100 active subs.
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = [
      `limit=${String(limit)}`,
      "status=all",
      "expand%5B%5D=data.items.data.price.product",
    ];
    if (startingAfter !== undefined) params.push(`starting_after=${startingAfter}`);
    const res = await http(`https://api.stripe.com/v1/subscriptions?${params.join("&")}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = (await res.json()) as {
      data?: Array<Parameters<typeof mapSubscription>[0]>;
      has_more?: boolean;
      error?: { message?: string };
    };
    if (res.status >= 400) {
      throw new StripeApiError(
        res.status,
        data.error?.message ?? `Stripe API error ${String(res.status)}`,
      );
    }
    const rows = (data.data ?? []).map(mapSubscription);
    out.push(...rows);
    const lastRaw = (data.data ?? [])[(data.data ?? []).length - 1];
    if (data.has_more !== true || lastRaw === undefined) break;
    startingAfter = lastRaw.id;
  }
  return out;
};
