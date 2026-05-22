import type { Agent } from "@prospero/shared";
import type { RecordActivityInput } from "../activity/recorder.js";
import type { Sender } from "../orchestrator/router.js";
import type { ApprovalKind } from "./types.js";

export interface CeoWakeDeps {
  getCeo: (companyId: string) => Agent | null; // CEO nao-terminado/nao-pausado, ou null
  ensureAgentRunner: (agent: Agent) => void;
  enqueue: (agentId: string, threadId: string, content: string, sender: Sender) => void;
  primaryThreadId: (agentId: string) => string;
  recordActivity: (input: RecordActivityInput) => void;
}

export type WakePayload = {
  approvalId: string;
  companyId: string;
  requesterName: string;
  summary: string;
  kind: ApprovalKind;
};

const instruction = (p: WakePayload): string =>
  [
    `Um agente da empresa fez uma requisicao que precisa da sua decisao como gestor.`,
    `Requisitante: ${p.requesterName}`,
    `Tipo: ${p.kind === "tool_call" ? "permissao de ferramenta" : "decisao gerencial"}`,
    `Pedido: ${p.summary}`,
    ``,
    `Decida agora chamando a ferramenta decide_request com approval_id="${p.approvalId}" e`,
    `decision igual a "approve", "reject" ou "escalate" (escale ao humano se for arriscado`,
    `ou se voce nao tiver contexto suficiente). Inclua uma nota curta justificando.`,
    `Se houver outras requisicoes pendentes, use list_pending_requests para resolve-las tambem.`,
  ].join("\n");

export const wakeCeoForApproval = (p: WakePayload, deps: CeoWakeDeps): boolean => {
  const ceo = deps.getCeo(p.companyId);
  if (ceo === null) return false;
  deps.ensureAgentRunner(ceo);
  const sender: Sender = {
    kind: "approval",
    id: p.approvalId,
    name: `Pedido de ${p.requesterName}`,
  };
  deps.enqueue(ceo.id, deps.primaryThreadId(ceo.id), instruction(p), sender);
  deps.recordActivity({
    companyId: p.companyId,
    actor: { kind: "system" },
    action: "approval.requested",
    entityKind: "approval",
    entityId: p.approvalId,
    agentId: ceo.id,
    payload: { kind: p.kind, toolName: p.summary.slice(0, 80) },
  });
  return true;
};
