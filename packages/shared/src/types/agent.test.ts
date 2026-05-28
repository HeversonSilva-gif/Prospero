import { describe, expect, it } from "vitest";
import { findActiveCeo, isActiveAgent } from "./agent.js";

type FakeCeo = {
  id: string;
  role: string;
  templateId: string | null;
  status: string;
  terminatedAt: number | null;
  createdAt: number;
};

const ceo = (over: Partial<FakeCeo>): FakeCeo => ({
  id: "a",
  role: "ceo",
  templateId: "role-ceo",
  status: "idle",
  terminatedAt: null,
  createdAt: 1,
  ...over,
});

describe("isActiveAgent", () => {
  it("excludes an agent whose terminatedAt is set even when status was reset to idle", () => {
    // The exact zombie shape seen in production: terminate() set status='terminated',
    // then a pause/resume cycle reset status back to 'idle' while terminated_at stuck.
    expect(isActiveAgent({ status: "idle", terminatedAt: 1_700_000_000_000 })).toBe(false);
  });

  it("excludes terminated and paused statuses", () => {
    expect(isActiveAgent({ status: "terminated", terminatedAt: null })).toBe(false);
    expect(isActiveAgent({ status: "paused", terminatedAt: null })).toBe(false);
  });

  it("accepts a live idle/working agent", () => {
    expect(isActiveAgent({ status: "idle", terminatedAt: null })).toBe(true);
    expect(isActiveAgent({ status: "working", terminatedAt: null })).toBe(true);
  });
});

describe("findActiveCeo", () => {
  it("prefers the live replacement CEO over an older terminated-but-idle CEO", () => {
    // Original "George" terminated (terminatedAt set, status zombie-reset to idle),
    // created first; replacement "George ||" created later, fully live. The old
    // status-only filter picked George (created_at ASC) — the bug.
    const george = ceo({ id: "george", status: "idle", terminatedAt: 999, createdAt: 1 });
    const georgeII = ceo({ id: "george-ii", status: "idle", terminatedAt: null, createdAt: 2 });
    expect(findActiveCeo([george, georgeII])?.id).toBe("george-ii");
  });

  it("returns null when every CEO is terminated", () => {
    expect(findActiveCeo([ceo({ terminatedAt: 1 }), ceo({ terminatedAt: 2 })])).toBeNull();
  });

  it("ignores non-CEO agents", () => {
    const worker = ceo({ id: "w", role: "Engenheiro", templateId: "role-eng" });
    const realCeo = ceo({ id: "c" });
    expect(findActiveCeo([worker, realCeo])?.id).toBe("c");
    expect(findActiveCeo([worker])).toBeNull();
  });
});
