import { describe, expect, it } from "vitest";
import { buildQueryRange, deriveAgentFilter } from "./useCostsQuery.js";

describe("buildQueryRange", () => {
  it("returns last 7 days from now in UTC milliseconds", () => {
    const now = Date.UTC(2026, 4, 12, 15);
    const range = buildQueryRange("7d", now);
    expect(range.to).toBe(now);
    expect(range.from).toBe(now - 7 * 86_400_000);
  });

  it("returns last 30 days for 30d", () => {
    const now = Date.UTC(2026, 4, 12);
    const range = buildQueryRange("30d", now);
    expect(range.from).toBe(now - 30 * 86_400_000);
  });

  it("returns same-day boundaries for 1d", () => {
    const now = Date.UTC(2026, 4, 12, 8);
    const range = buildQueryRange("1d", now);
    expect(range.to).toBe(now);
    expect(range.from).toBe(now - 86_400_000);
  });
});

describe("deriveAgentFilter", () => {
  it("returns refId when scope is 'agent' and id provided", () => {
    expect(deriveAgentFilter("agent", "ag_1")).toEqual({ scope: "agent", refId: "ag_1" });
  });

  it("returns scope only when refId is empty", () => {
    expect(deriveAgentFilter("agent", "")).toEqual({ scope: "agent" });
  });

  it("returns company scope by default", () => {
    expect(deriveAgentFilter("company", "")).toEqual({ scope: "company" });
  });
});
