import { describe, expect, it } from "vitest";
import type { ActivityEventRow } from "@dashboard-agent/shared";
import { matchesFilters, mergeNew } from "./useActivityStream.js";

const row = (over: Partial<ActivityEventRow>): ActivityEventRow => ({
  id: "evt_1",
  companyId: "co_1",
  actorKind: "user",
  actorId: null,
  action: "agent.hired",
  entityKind: "agent",
  entityId: "ag_1",
  agentId: "ag_1",
  payload: {},
  createdAt: 1_000,
  ...over,
});

describe("matchesFilters", () => {
  it("passes when no filters set", () => {
    expect(matchesFilters(row({}), {})).toBe(true);
  });

  it("rejects on actorKind mismatch", () => {
    expect(matchesFilters(row({ actorKind: "agent" }), { actorKind: "user" })).toBe(false);
    expect(matchesFilters(row({ actorKind: "user" }), { actorKind: "user" })).toBe(true);
  });

  it("rejects on action mismatch", () => {
    expect(matchesFilters(row({ action: "agent.hired" }), { action: "issue.created" })).toBe(false);
  });

  it("rejects on entityKind mismatch", () => {
    expect(matchesFilters(row({ entityKind: "agent" }), { entityKind: "issue" })).toBe(false);
  });

  it("rejects on agentId mismatch", () => {
    expect(matchesFilters(row({ agentId: "ag_2" }), { agentId: "ag_1" })).toBe(false);
  });

  it("respects sinceMs / untilMs window", () => {
    expect(matchesFilters(row({ createdAt: 500 }), { sinceMs: 1_000 })).toBe(false);
    expect(matchesFilters(row({ createdAt: 1_500 }), { sinceMs: 1_000 })).toBe(true);
    expect(matchesFilters(row({ createdAt: 2_000 }), { untilMs: 1_000 })).toBe(false);
  });
});

describe("mergeNew", () => {
  it("prepends new row when id not present", () => {
    const existing = [row({ id: "evt_1", createdAt: 1_000 })];
    const incoming = row({ id: "evt_2", createdAt: 2_000 });
    expect(mergeNew(existing, incoming).map((r) => r.id)).toEqual(["evt_2", "evt_1"]);
  });

  it("returns same list when id already present (dedupe)", () => {
    const existing = [row({ id: "evt_1", createdAt: 1_000 })];
    const incoming = row({ id: "evt_1", createdAt: 1_000 });
    const merged = mergeNew(existing, incoming);
    expect(merged).toBe(existing);
  });
});
