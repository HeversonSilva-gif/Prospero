import type { ConnectionsRepository } from "./connections-repository.js";
import { createProduct, createPrice, createPaymentLink, type StripeHttp } from "./stripe-client.js";

// One line of the charge model to enact in Stripe. `interval` ⇒ a recurring price.
export type StripeChargeItem = {
  name: string;
  description: string;
  amount: number;
  currency: string;
  interval?: "month" | "year";
};

export type StripeSetupResult = { url: string; paymentLinkId: string };

// MAIN-process action behind the setup_monetization / create_payment_link MCP tools.
// Decrypts the company's restricted key, creates a product + price per item, and ONE
// payment link over those prices. Runs ONLY after the agent's tool call passed the
// approval gate. Throws a clear error (surfaced to the agent) when Stripe isn't
// connected yet or there is nothing to charge for.
export const executeStripeSetup = async (
  repo: ConnectionsRepository,
  http: StripeHttp,
  companyId: string,
  items: StripeChargeItem[],
): Promise<StripeSetupResult> => {
  const conn = repo.load(companyId, "stripe");
  const key =
    conn !== null && typeof conn.payload.restrictedKey === "string"
      ? conn.payload.restrictedKey
      : null;
  if (key === null) {
    throw new Error("Stripe não conectado para esta empresa (conecte em Ajustes › Conta).");
  }
  if (items.length === 0) {
    throw new Error("Nenhum item de cobrança para configurar.");
  }
  const lineItems: { price: string; quantity: number }[] = [];
  for (const item of items) {
    const product = await createProduct(http, key, {
      name: item.name,
      description: item.description,
    });
    const price = await createPrice(http, key, {
      product: product.id,
      unitAmount: item.amount,
      currency: item.currency,
      ...(item.interval !== undefined ? { interval: item.interval } : {}),
    });
    lineItems.push({ price: price.id, quantity: 1 });
  }
  const link = await createPaymentLink(http, key, { lineItems });
  return { url: link.url, paymentLinkId: link.id };
};
