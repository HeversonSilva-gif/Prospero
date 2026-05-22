import type Database from "better-sqlite3";
import type { Approval, ManagerRequestPayload } from "./types.js";
import { tryGetApprovalBridge } from "./index.js";

// Wakes the requester with the managerial decision outcome. Reuses the engine
// bridge (enqueue/ensureAgentRunner). Lives in its own module to avoid an import
// cycle between tools.ts and approvals/index.ts.
export const deliverManagerDecision = (
  _db: Database.Database,
  approval: Approval,
  status: "approved" | "rejected",
  note: string,
): void => {
  const bridge = tryGetApprovalBridge();
  if (bridge === null || approval.agentId === null) return;
  const payload = JSON.parse(approval.payloadJson) as ManagerRequestPayload;
  const agent = bridge.getAgent(approval.agentId);
  if (agent === null) return;
  bridge.ensureAgentRunner(agent);
  const verdict = status === "approved" ? "APROVADO" : "REJEITADO";
  const content = `Sua requisicao ao gestor ("${payload.summary}") foi ${verdict}.${note ? ` Nota do gestor: ${note}` : ""}`;
  bridge.enqueue(agent.id, payload.thread_id, content, {
    kind: "approval",
    id: approval.id,
    name: "Gestor",
  });
};
