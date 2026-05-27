import { describe, it, expect } from "vitest";
import { routeApprovalRequest } from "./routing.js";

const base = {
  kind: "tool_call" as const,
  reason: "supervised mode",
  requesterIsCeo: false,
  ceoAvailable: true,
};

describe("routeApprovalRequest", () => {
  it("routes supervised-mode tool calls to the CEO", () => {
    expect(routeApprovalRequest(base)).toBe("ceo");
  });

  it("routes always-blocked tool calls to the human", () => {
    expect(routeApprovalRequest({ ...base, reason: "always-blocked sensitive path" })).toBe("user");
  });

  it("routes to human when no CEO is available", () => {
    expect(routeApprovalRequest({ ...base, ceoAvailable: false })).toBe("user");
  });

  it("routes the CEO's own requests to the human", () => {
    expect(routeApprovalRequest({ ...base, requesterIsCeo: true })).toBe("user");
  });

  it("routes manager_request fire-topic to the human", () => {
    expect(
      routeApprovalRequest({
        kind: "manager_request",
        reason: "",
        requesterIsCeo: false,
        ceoAvailable: true,
        managerTopic: "fire",
      }),
    ).toBe("user");
  });

  it("routes budget-over-limit manager_request to the human", () => {
    expect(
      routeApprovalRequest({
        kind: "manager_request",
        reason: "",
        requesterIsCeo: false,
        ceoAvailable: true,
        managerTopic: "budget",
        budgetOverLimit: true,
      }),
    ).toBe("user");
  });

  it("routes ordinary manager_request to the CEO", () => {
    expect(
      routeApprovalRequest({
        kind: "manager_request",
        reason: "",
        requesterIsCeo: false,
        ceoAvailable: true,
        managerTopic: "hire",
      }),
    ).toBe("ceo");
  });

  it("precedence: no CEO beats every other rule", () => {
    expect(routeApprovalRequest({ ...base, ceoAvailable: false, requesterIsCeo: true })).toBe(
      "user",
    );
  });
});

describe("routeApprovalRequest — relaxed flags (M20 async governance)", () => {
  const base = {
    kind: "manager_request" as const,
    reason: "",
    requesterIsCeo: false,
    ceoAvailable: true,
  };

  it("relaxedFires=true sends fire to ceo instead of user", () => {
    expect(routeApprovalRequest({ ...base, managerTopic: "fire", relaxedFires: true })).toBe("ceo");
  });

  it("relaxedBudgets=true sends budget overrun to ceo instead of user", () => {
    expect(
      routeApprovalRequest({
        ...base,
        managerTopic: "budget",
        budgetOverLimit: true,
        relaxedBudgets: true,
      }),
    ).toBe("ceo");
  });

  it("relaxed flags do NOT bypass requesterIsCeo=true (CEO never auto-fires himself)", () => {
    expect(
      routeApprovalRequest({
        ...base,
        requesterIsCeo: true,
        managerTopic: "fire",
        relaxedFires: true,
      }),
    ).toBe("user");
  });
});
