import type { ConnectionsRepository } from "./connections-repository.js";
import type { StripeHttp } from "./stripe-client.js";
import { executeStripeSetup, type StripeChargeItem } from "./stripe-monetization-executor.js";

// Payload carried by the `stripe.setup` side-channel event the setup_monetization /
// create_payment_link MCP tools emit (in the MCP child) after their tool call passes
// the approval gate.
export type StripeSetupEventPayload = { requestId: string; items: StripeChargeItem[] };

// Result the tool polls for (keyed by requestId) so it can return the payment link —
// or a clear error — to the agent in the same turn.
export type StripeSetupEventResult =
  | { ok: true; url: string; paymentLinkId: string }
  | { ok: false; error: string };

// MAIN-process reaction to a `stripe.setup` event. Only MAIN holds the safeStorage
// cipher to decrypt the company's restricted key, so the Stripe calls happen here
// (not in the MCP child). Never throws: a failure writes an `ok: false` result so the
// waiting tool resolves instead of timing out.
export const handleStripeSetupEvent = async (
  deps: {
    repo: ConnectionsRepository;
    http: StripeHttp;
    writeResult: (requestId: string, result: StripeSetupEventResult) => void;
  },
  companyId: string,
  payload: StripeSetupEventPayload,
): Promise<void> => {
  try {
    const r = await executeStripeSetup(deps.repo, deps.http, companyId, payload.items);
    deps.writeResult(payload.requestId, { ok: true, url: r.url, paymentLinkId: r.paymentLinkId });
  } catch (e) {
    deps.writeResult(payload.requestId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
