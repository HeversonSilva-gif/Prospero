import type { InboxItem } from "@prospero/shared";
import type { RiskKind } from "./risk.js";

// Gated tools that carry a money/publish risk. Read-only/safe tools never reach
// the inbox as approvals, so they aren't listed (→ no pill).
const TOOL_RISK: Record<string, RiskKind> = {
  setup_monetization: "money",
  create_payment_link: "money",
  post_to_x: "publish",
  reply_on_x: "publish",
  deploy_app: "publish",
  send_email: "publish",
};

// The risk to show on a decision card. Only approval (tool-call) items carry a
// money/publish risk, derived from the gated tool's name. Everything else → null.
export const inboxRisk = (item: InboxItem): RiskKind | null => {
  if (item.kind !== "approval" || item.payloadJson === null) return null;
  try {
    const p = JSON.parse(item.payloadJson) as { toolName?: unknown };
    if (typeof p.toolName !== "string") return null;
    return TOOL_RISK[p.toolName] ?? null;
  } catch {
    return null;
  }
};
