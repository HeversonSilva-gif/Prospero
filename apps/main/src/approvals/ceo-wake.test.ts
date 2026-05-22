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
    // Verify agentId, threadId, and instruction content
    expect(d.enqueue).toHaveBeenCalledWith(
      "ceo1",
      "th-ceo",
      expect.stringContaining("apv1"),
      expect.objectContaining({ kind: "approval", id: "apv1" }),
    );
    expect(d.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining("decide_request"),
      expect.anything(),
    );
    expect(d.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ name: expect.stringContaining("Bot") }),
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
