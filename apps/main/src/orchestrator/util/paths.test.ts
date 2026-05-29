import { describe, it, expect } from "vitest";
import { shortAgentSlug } from "./paths.js";

describe("shortAgentSlug", () => {
  it("strips the agent_ prefix and dashes, taking the first 12 hex chars", () => {
    expect(shortAgentSlug("agent_2754ee4b-0121-4b84-a3a0-47673d37493f")).toBe("2754ee4b0121");
  });

  it("is deterministic — same id maps to the same slug", () => {
    const id = "agent_d9de0a69-f74b-4b47-9efa-caa7b0818312";
    expect(shortAgentSlug(id)).toBe(shortAgentSlug(id));
  });

  it("distinct agent uuids map to distinct slugs", () => {
    const a = shortAgentSlug("agent_2754ee4b-0121-4b84-a3a0-47673d37493f");
    const b = shortAgentSlug("agent_d9de0a69-f74b-4b47-9efa-caa7b0818312");
    expect(a).not.toBe(b);
  });

  it("handles an id without the agent_ prefix", () => {
    expect(shortAgentSlug("d9de0a69-f74b-4b47")).toBe("d9de0a69f74b");
  });

  it("produces a slug of only lowercase hex chars", () => {
    expect(shortAgentSlug("agent_2754ee4b-0121-4b84-a3a0-47673d37493f")).toMatch(
      /^[a-f0-9]{1,12}$/,
    );
  });
});
