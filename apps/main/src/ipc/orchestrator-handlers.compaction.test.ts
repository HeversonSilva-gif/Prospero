// Tests for the compaction decision helpers and the shouldResetSession gate.
// The orchestrator's maybeCompactAfterTurn is not directly unit-testable
// (it closes over all of IPC state), so we test the pure helpers that govern
// its two bug-fix behaviors:
//   1. Session reset is ONLY triggered on a successful distill (distillKind="ok").
//   2. The cooldown is always set — including on a discard/failed distill — so
//      a broken distill cannot retry on every subsequent turn (retry storm).
//
// The CompactionWorker integration (distillKind surfacing) is tested here too
// so that the full chain from worker.compact → shouldResetSession is verified.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldResetSession } from "../context/compaction-decision.js";
import { createCompactionWorker } from "../context/compaction-worker.js";
import { readDigestAt } from "../context/digest-store.js";

// ---------------------------------------------------------------------------
// Pure decision helper
// ---------------------------------------------------------------------------
describe("shouldResetSession", () => {
  it("returns true when distillKind is 'ok'", () => {
    expect(shouldResetSession("ok")).toBe(true);
  });

  it("returns false when distillKind is 'discard'", () => {
    expect(shouldResetSession("discard")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CompactionWorker.distillKind surfacing
// ---------------------------------------------------------------------------
let dir: string;
let digestPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compaction-orchestrator-test-"));
  digestPath = join(dir, "digest.json");
});

describe("CompactionWorker distillKind", () => {
  it("returns distillKind='ok' when the model output is a valid JSON blob", async () => {
    const worker = createCompactionWorker({
      runDistill: () =>
        Promise.resolve({
          text: JSON.stringify({
            knowledge: [
              { section: "architecture", body: "Electron monorepo.", source_files: ["pkg.json"] },
            ],
            taskState: "On BACKEND-7; run tests next.",
          }),
          usage: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0 },
        }),
      hashSources: () => "hash-abc",
      newId: () => "dig-fixed",
      now: () => 1_000_000,
      onCost: () => {},
    });

    const result = await worker.compact({
      companyId: "co_1",
      agentId: "ag_1",
      transcript: "agent: read package.json",
      digestPath,
    });

    expect(result.distillKind).toBe("ok");
    // Digest was written
    expect(readDigestAt(digestPath).entries).toHaveLength(1);
    // shouldResetSession must agree: ok → reset
    expect(shouldResetSession(result.distillKind)).toBe(true);
  });

  it("returns distillKind='discard' when the model output is garbage", async () => {
    const worker = createCompactionWorker({
      runDistill: () =>
        Promise.resolve({
          text: "I could not summarize anything useful.",
          usage: { input: 3, output: 1, cacheCreation: 0, cacheRead: 0 },
        }),
      hashSources: () => "x",
      newId: () => "id",
      now: () => 1,
      onCost: () => {},
    });

    const result = await worker.compact({
      companyId: "co_1",
      agentId: "ag_1",
      transcript: "agent: did some work",
      digestPath,
    });

    expect(result.distillKind).toBe("discard");
    // No digest was written
    expect(readDigestAt(digestPath).entries).toHaveLength(0);
    // shouldResetSession must agree: discard → no reset
    expect(shouldResetSession(result.distillKind)).toBe(false);
  });

  it("returns distillKind='ok' with empty knowledge array when model returns no knowledge items", async () => {
    const worker = createCompactionWorker({
      runDistill: () =>
        Promise.resolve({
          text: JSON.stringify({ knowledge: [], taskState: "Nothing significant learned." }),
          usage: { input: 5, output: 2, cacheCreation: 0, cacheRead: 0 },
        }),
      hashSources: () => "",
      newId: () => "id",
      now: () => 1,
      onCost: () => {},
    });

    const result = await worker.compact({
      companyId: "co_1",
      agentId: "ag_1",
      transcript: "agent: hello",
      digestPath,
    });

    // Empty knowledge = valid parse, still "ok" — the distill succeeded, it
    // just learned nothing new. Session reset is still valid (cache grows).
    expect(result.distillKind).toBe("ok");
    expect(result.foldedCount).toBe(0);
    expect(shouldResetSession(result.distillKind)).toBe(true);
  });

  it("returns distillKind='discard' when the model returns malformed JSON", async () => {
    const worker = createCompactionWorker({
      runDistill: () =>
        Promise.resolve({
          text: '{ "knowledge": [broken json',
          usage: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
        }),
      hashSources: () => "",
      newId: () => "id",
      now: () => 1,
      onCost: () => {},
    });

    const result = await worker.compact({
      companyId: "co_1",
      agentId: "ag_1",
      transcript: "agent: work",
      digestPath,
    });

    expect(result.distillKind).toBe("discard");
    expect(shouldResetSession(result.distillKind)).toBe(false);
  });
});
