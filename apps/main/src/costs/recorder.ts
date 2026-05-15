// Glue between adapter usage events and persisted cost_events rows.
// recordTurn validates non-zero usage, computes cost cents via the pricing
// table, persists, and broadcasts a small delta for live UI updates.

import type { UsageEstimate } from "@prospero/shared";
import { estimateCostCents } from "./pricing.js";
import type { CostsRepository } from "./repository.js";

export type RecordTurnInput = {
  companyId: string;
  agentId: string;
  projectId: string | null;
  issueId: string | null;
  adapterName: string;
  model: string | null;
  sessionId: string | null;
  usage: UsageEstimate;
};

export type CostsBroadcastPayload = {
  agentId: string;
  deltaTokens: number;
  deltaCents: number;
};

export type CostsBroadcast = (payload: CostsBroadcastPayload) => void;

export type CostRecorderDeps = {
  costsRepo: CostsRepository;
  broadcast: CostsBroadcast;
  now?: () => number;
};

export type CostRecorder = {
  recordTurn(input: RecordTurnInput): { eventId: string; costCents: number };
};

const sumUsage = (u: UsageEstimate): number => u.input + u.output + u.cache_creation + u.cache_read;

export const createCostRecorder = (deps: CostRecorderDeps): CostRecorder => {
  const now = deps.now ?? ((): number => Date.now());

  const recordTurn = (input: RecordTurnInput): { eventId: string; costCents: number } => {
    const totalTokens = sumUsage(input.usage);
    if (totalTokens === 0) return { eventId: "", costCents: 0 };

    const costCents = estimateCostCents(input.model ?? undefined, input.usage);
    const row = deps.costsRepo.insert({
      companyId: input.companyId,
      agentId: input.agentId,
      projectId: input.projectId,
      issueId: input.issueId,
      adapterName: input.adapterName,
      model: input.model,
      sessionId: input.sessionId,
      inputTokens: input.usage.input,
      outputTokens: input.usage.output,
      cacheCreationTokens: input.usage.cache_creation,
      cacheReadTokens: input.usage.cache_read,
      costCentsEstimate: costCents,
      occurredAt: now(),
    });

    try {
      deps.broadcast({
        agentId: input.agentId,
        deltaTokens: totalTokens,
        deltaCents: costCents,
      });
    } catch (err) {
      console.warn("[costs] broadcast failed", err);
    }
    return { eventId: row.id, costCents };
  };

  return { recordTurn };
};
