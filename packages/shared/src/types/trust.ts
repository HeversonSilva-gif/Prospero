// M14 PR-A — shared trust types. The score is NOT a stored field — `TrackRecord`
// is computed on demand from existing tables (goals/goal_criteria/approvals/
// activity_events). `evaluateTier` is the only authority for the eligible tier.

export type TrustTier = "novato" | "confiavel" | "autonomo";

export type TrustEventKind = "promoted" | "demoted" | "promotion_suggested";

export interface TrustEvent {
  id: string;
  agentId: string;
  kind: TrustEventKind;
  fromTier: TrustTier;
  toTier: TrustTier;
  reason: string;
  createdAt: number;
}

export interface TrackRecord {
  /** Goals reached 'achieved' (all ISCs green) where this agent owned/contributed. */
  verifiedOutcomes: number;
  /** 0..1 — ISCs that passed without retrabalho. NaN-safe: defaults to 0 if total=0. */
  iscFirstPassRate: number;
  approvalsAccepted: number;
  approvalsRejected: number;
  /** Failures of any ISC the agent worked, inside the trust window. */
  verificationFailures: number;
  /** True iff a `demoted` event exists inside the trust window. */
  demotedInWindow: boolean;
}

export interface TierEvaluation {
  current: TrustTier;
  eligible: TrustTier;
  /** Non-null when the next tier was almost reached but blocked by some criterion. */
  blockedReason: string | null;
}
