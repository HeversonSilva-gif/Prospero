import type { TierEvaluation, TrackRecord, TrustTier } from "@prospero/shared";

// M14 PR-A — thresholds. Concrete but tunable; calibrate with real use.
// "Confiança mal calibrada é pior que sem confiança" — start conservative.
export const CONFIAVEL_MIN_OUTCOMES = 5;
export const AUTONOMO_MIN_OUTCOMES = 15;
export const AUTONOMO_MIN_PASS_RATE = 0.9;

const TIER_ORDER: TrustTier[] = ["novato", "confiavel", "autonomo"];
const oneTierBelow = (t: TrustTier): TrustTier => {
  const i = TIER_ORDER.indexOf(t);
  return i <= 0 ? "novato" : TIER_ORDER[i - 1]!;
};

// Pure evaluation of the eligible tier from a TrackRecord. No DB, no I/O,
// no side effects. The engine (`engine.ts`) is the only authority that
// applies the eligible tier; this function just decides what it should be.
export const evaluateTier = (record: TrackRecord, current: TrustTier): TierEvaluation => {
  // A verification failure erodes confidence — but demote at most ONE tier per
  // recompute rather than collapsing straight to novato. A single (often flaky)
  // failure shouldn't erase months of standing; an autonomo agent drops to
  // confiavel (which the engine also reverts to supervised mode), not novato.
  // Audit 2026-06-03 (learning report #10).
  if (record.verificationFailures > 0) {
    return {
      current,
      eligible: oneTierBelow(current),
      blockedReason: `${record.verificationFailures} falha(s) de verificação no período`,
    };
  }

  let eligible: TrustTier = "novato";
  let blockedReason: string | null = null;

  if (record.verifiedOutcomes >= CONFIAVEL_MIN_OUTCOMES) {
    eligible = "confiavel";
  }

  if (
    eligible === "confiavel" &&
    record.verifiedOutcomes >= AUTONOMO_MIN_OUTCOMES &&
    record.iscFirstPassRate >= AUTONOMO_MIN_PASS_RATE &&
    !record.demotedInWindow
  ) {
    eligible = "autonomo";
  } else if (eligible === "confiavel" && record.verifiedOutcomes >= AUTONOMO_MIN_OUTCOMES) {
    if (record.demotedInWindow) {
      blockedReason = "rebaixamento recente — aguardar o período passar";
    } else if (record.iscFirstPassRate < AUTONOMO_MIN_PASS_RATE) {
      blockedReason = `taxa de primeira tentativa ${(record.iscFirstPassRate * 100).toFixed(0)}% < ${AUTONOMO_MIN_PASS_RATE * 100}% requerido`;
    }
  }

  return { current, eligible, blockedReason };
};
