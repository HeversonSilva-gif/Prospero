import { describe, it, expect } from "vitest";
import type { TrackRecord } from "@prospero/shared";
import { evaluateTier } from "./evaluate.js";

const base = (overrides: Partial<TrackRecord> = {}): TrackRecord => ({
  verifiedOutcomes: 0,
  iscFirstPassRate: 0,
  approvalsAccepted: 0,
  approvalsRejected: 0,
  verificationFailures: 0,
  demotedInWindow: false,
  ...overrides,
});

describe("evaluateTier", () => {
  it("0 outcomes → eligible novato", () => {
    expect(evaluateTier(base(), "novato").eligible).toBe("novato");
  });

  it("5 verified outcomes + 0 failures → eligible confiavel", () => {
    expect(evaluateTier(base({ verifiedOutcomes: 5 }), "novato").eligible).toBe("confiavel");
  });

  it("5 verified outcomes WITH a failure → eligible novato, blockedReason set", () => {
    const ev = evaluateTier(base({ verifiedOutcomes: 5, verificationFailures: 1 }), "novato");
    expect(ev.eligible).toBe("novato");
    expect(ev.blockedReason).toMatch(/falha/i);
  });

  it("15 outcomes + 0.9 pass-rate + 0 failures + not demoted → eligible autonomo", () => {
    expect(
      evaluateTier(base({ verifiedOutcomes: 15, iscFirstPassRate: 0.9 }), "confiavel").eligible,
    ).toBe("autonomo");
  });

  it("15 outcomes + 0.85 pass-rate (under threshold) → eligible confiavel only", () => {
    const ev = evaluateTier(base({ verifiedOutcomes: 15, iscFirstPassRate: 0.85 }), "confiavel");
    expect(ev.eligible).toBe("confiavel");
    expect(ev.blockedReason).toMatch(/85%/);
  });

  it("15 outcomes + 0.9 pass-rate but demotedInWindow → eligible confiavel, blocked", () => {
    const ev = evaluateTier(
      base({ verifiedOutcomes: 15, iscFirstPassRate: 0.9, demotedInWindow: true }),
      "confiavel",
    );
    expect(ev.eligible).toBe("confiavel");
    expect(ev.blockedReason).toMatch(/rebaixamento/i);
  });

  it("current is preserved on the evaluation", () => {
    const ev = evaluateTier(base({ verifiedOutcomes: 5 }), "confiavel");
    expect(ev.current).toBe("confiavel");
  });

  it("autonomo agent with a recent failure → eligible drops to novato", () => {
    const ev = evaluateTier(
      base({ verifiedOutcomes: 20, verificationFailures: 1, iscFirstPassRate: 0.9 }),
      "autonomo",
    );
    expect(ev.eligible).toBe("novato");
  });

  it("blockedReason is null when current === eligible at the top tier", () => {
    expect(
      evaluateTier(base({ verifiedOutcomes: 20, iscFirstPassRate: 0.95 }), "autonomo")
        .blockedReason,
    ).toBeNull();
  });
});
