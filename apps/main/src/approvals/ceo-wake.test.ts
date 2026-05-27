import { describe, it, expect, vi } from "vitest";
import { wakeCeoForApproval, type CeoWakeDeps } from "./ceo-wake.js";
import type { Agent } from "@prospero/shared";

const ceo = { id: "ceo1", companyId: "c1", status: "idle" } as unknown as Agent;

function deps(over: Partial<CeoWakeDeps> = {}): CeoWakeDeps {
  return {
    getCeo: () => ceo,
    ensureAgentRunner: vi.fn(),
    enqueue: vi.fn(),
    primaryThreadId: () => "th-ceo",
    recordActivity: vi.fn(),
    ...over,
  };
}

describe("wakeCeoForApproval", () => {
  it("enqueues a turn for the CEO with the approval id and an instruction to decide", () => {
    const d = deps();
    const ok = wakeCeoForApproval(
      {
        approvalId: "apv1",
        companyId: "c1",
        requesterName: "Bot",
        summary: "Write file X",
        kind: "tool_call",
      },
      d,
    );
    expect(ok).toBe(true);
    expect(d.ensureAgentRunner).toHaveBeenCalledWith(ceo);
    // Verify agentId, threadId, sender, and instruction content. Both checks pin
    // agentId+threadId so they can only match the same single enqueue call.
    expect(d.enqueue).toHaveBeenCalledWith(
      "ceo1",
      "th-ceo",
      expect.stringContaining("apv1"),
      expect.objectContaining({
        kind: "approval",
        id: "apv1",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        name: expect.stringContaining("Bot"),
      }),
    );
    expect(d.enqueue).toHaveBeenCalledWith(
      "ceo1",
      "th-ceo",
      expect.stringContaining("decide_request"),
      expect.anything(),
    );
    // Verify the approval.requested activity was recorded for the CEO.
    expect(d.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approval.requested",
        entityId: "apv1",
        agentId: "ceo1",
      }),
    );
  });

  it("returns false (no wake) when there is no available CEO", () => {
    const d = deps({ getCeo: () => null });
    const ok = wakeCeoForApproval(
      {
        approvalId: "apv1",
        companyId: "c1",
        requesterName: "Bot",
        summary: "x",
        kind: "tool_call",
      },
      d,
    );
    expect(ok).toBe(false);
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});

describe("wakeCeoForApproval — bouncedFromHuman flag (M20 async governance)", () => {
  it("when bouncedFromHuman is true, the enqueued prompt includes the bounce notice", () => {
    const d = deps();
    const ok = wakeCeoForApproval(
      {
        approvalId: "apv2",
        companyId: "c1",
        requesterName: "Alice",
        summary: "Read config file",
        kind: "tool_call",
      },
      d,
      { bouncedFromHuman: true },
    );
    expect(ok).toBe(true);
    expect(d.enqueue).toHaveBeenCalledWith(
      "ceo1",
      "th-ceo",
      expect.stringContaining(
        "Usuário não respondeu em algumas horas. Decida você (não pode escalar de novo). Se incerto, prefira rejeitar.",
      ),
      expect.anything(),
    );
  });

  it("default behavior (no options arg) does NOT include the bounce notice", () => {
    const d = deps();
    const ok = wakeCeoForApproval(
      {
        approvalId: "apv3",
        companyId: "c1",
        requesterName: "Charlie",
        summary: "Delete file Y",
        kind: "tool_call",
      },
      d,
    );
    expect(ok).toBe(true);
    expect(d.enqueue).toHaveBeenCalledWith(
      "ceo1",
      "th-ceo",
      expect.not.stringContaining("Usuário não respondeu"),
      expect.anything(),
    );
  });
});
