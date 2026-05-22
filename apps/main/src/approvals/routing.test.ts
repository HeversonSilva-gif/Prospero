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
