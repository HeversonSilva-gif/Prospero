import type { ApprovalKind, ApprovalRoute, ManagerTopic } from "./types.js";
import { ALWAYS_BLOCKED_TAG } from "../security/gate.js";

export type RouteInput = {
  kind: ApprovalKind;
  reason: string;
  requesterIsCeo: boolean;
  ceoAvailable: boolean;
  managerTopic?: ManagerTopic;
  budgetOverLimit?: boolean;
  /** Async governance — when true, fires (rule 4) fall through to CEO. */
  relaxedFires?: boolean;
  /** Async governance — when true, budget overruns (rule 5) fall through to CEO. */
  relaxedBudgets?: boolean;
};

// Decide o PRIMEIRO destino de uma requisicao. Criterio-do-CEO (escalar) e
// timeout NAO ficam aqui — sao passos posteriores. Ordem das regras importa.
export const routeApprovalRequest = (input: RouteInput): ApprovalRoute => {
  if (!input.ceoAvailable) return "user"; // 1
  if (input.requesterIsCeo) return "user"; // 2 (nao auto-aprova)
  if (input.kind === "tool_call" && input.reason.includes(ALWAYS_BLOCKED_TAG)) return "user"; // 3
  if (input.kind === "manager_request") {
    if (input.managerTopic === "fire" && input.relaxedFires !== true) return "user"; // 4
    if (input.budgetOverLimit === true && input.relaxedBudgets !== true) return "user"; // 5
  }
  return "ceo"; // 6 default
};
