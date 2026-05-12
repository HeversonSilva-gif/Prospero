import { describe, expect, it } from "vitest";
import { ACTIVITY_ACTIONS } from "@dashboard-agent/shared";
import { ActivityPayloads } from "../src/activity/schemas.js";

describe("ActivityPayloads", () => {
  it("has a Zod schema for every ActivityAction (exhaustiveness)", () => {
    for (const action of ACTIVITY_ACTIONS) {
      expect(ActivityPayloads[action], `missing schema for ${action}`).toBeDefined();
    }
  });

  it("agent.model_changed accepts valid payload", () => {
    const parsed = ActivityPayloads["agent.model_changed"].safeParse({
      from: "sonnet-4-6",
      to: "opus-4-7",
    });
    expect(parsed.success).toBe(true);
  });

  it("agent.model_changed rejects missing 'to' field", () => {
    const parsed = ActivityPayloads["agent.model_changed"].safeParse({ from: "sonnet-4-6" });
    expect(parsed.success).toBe(false);
  });

  it("issue.created requires identifier, title, assigneeAgentId", () => {
    const ok = ActivityPayloads["issue.created"].safeParse({
      identifier: "BACK-1",
      title: "Build foo",
      assigneeAgentId: null,
    });
    expect(ok.success).toBe(true);
    const bad = ActivityPayloads["issue.created"].safeParse({ title: "x" });
    expect(bad.success).toBe(false);
  });

  it("agent.resumed accepts empty payload", () => {
    const parsed = ActivityPayloads["agent.resumed"].safeParse({});
    expect(parsed.success).toBe(true);
  });
});
