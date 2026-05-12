import { describe, expect, it } from "vitest";
import type { ActivityEventRow } from "@dashboard-agent/shared";
import { matchesSearch } from "./Activity.js";

const row = (over: Partial<ActivityEventRow>): ActivityEventRow => ({
  id: "evt_1",
  companyId: "co_1",
  actorKind: "user",
  actorId: null,
  action: "agent.hired",
  entityKind: "agent",
  entityId: "ag_1",
  agentId: "ag_1",
  payload: { name: "BackendEng", role: "BackendEng" },
  createdAt: 0,
  ...over,
});

describe("matchesSearch", () => {
  it("empty query matches everything", () => {
    expect(matchesSearch(row({}), "")).toBe(true);
    expect(matchesSearch(row({}), "   ")).toBe(true);
  });

  it("matches against action", () => {
    expect(matchesSearch(row({ action: "issue.created" }), "issue")).toBe(true);
  });

  it("matches against payload values case-insensitively", () => {
    expect(matchesSearch(row({ payload: { name: "BackendEng" } }), "backend")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(
      matchesSearch(row({ action: "agent.hired", payload: { name: "Frontend" } }), "queryX"),
    ).toBe(false);
  });
});
