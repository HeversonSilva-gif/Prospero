import { describe, expect, it } from "vitest";
import type { AgentRunRow } from "@prospero/shared";
import { groupRunsBySession } from "./groupRunsBySession.js";

const run = (over: Partial<AgentRunRow>): AgentRunRow => ({
  id: "r1",
  agentId: "ag1",
  occurredAt: 1,
  model: "claude-sonnet-4-6",
  adapterName: "claude-oauth-local",
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costCentsEstimate: 0,
  issueId: null,
  sessionId: "s1",
  ...over,
});

describe("groupRunsBySession", () => {
  it("returns an empty array for empty input", () => {
    expect(groupRunsBySession([])).toEqual([]);
  });

  it("groups consecutive runs of the same session", () => {
    const out = groupRunsBySession([
      run({ id: "a", sessionId: "s1" }),
      run({ id: "b", sessionId: "s1" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sessionId).toBe("s1");
    expect(out[0]!.runs.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("starts a new group when session_id changes", () => {
    const out = groupRunsBySession([
      run({ id: "a", sessionId: "s1" }),
      run({ id: "b", sessionId: "s2" }),
    ]);
    expect(out.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  it("isolates each null-session run into its own group", () => {
    const out = groupRunsBySession([
      run({ id: "a", sessionId: null }),
      run({ id: "b", sessionId: null }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.runs.map((r) => r.id)).toEqual(["a"]);
    expect(out[1]!.runs.map((r) => r.id)).toEqual(["b"]);
  });
});
