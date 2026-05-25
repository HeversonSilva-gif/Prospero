import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompactionWorker } from "./compaction-worker.js";
import { readDigest } from "./digest-store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compw-"));
});

describe("compaction-worker", () => {
  it("folds distilled knowledge into the digest and returns the seed", async () => {
    const worker = createCompactionWorker({
      userDataDir: dir,
      runDistill: () =>
        Promise.resolve({
          text: JSON.stringify({
            knowledge: [
              {
                section: "architecture",
                body: "Electron monorepo.",
                source_files: ["package.json"],
              },
            ],
            taskState: "On BACKEND-7; run tests next.",
          }),
          usage: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
        }),
      hashSources: () => "abc",
      newId: () => "fixed-id",
      now: () => 123,
      onCost: () => {},
    });

    const result = await worker.compact({
      companyId: "co_1",
      projectId: "pr_1",
      agentId: "ag_1",
      transcript: "agent read package.json",
    });

    expect(result.taskState).toContain("BACKEND-7");
    const digest = readDigest(dir, "co_1", "pr_1");
    expect(digest.entries[0]?.body).toBe("Electron monorepo.");
    expect(digest.entries[0]?.contentHash).toBe("abc");
    expect(digest.entries[0]?.trust).toBe(0.5);
    expect(digest.entries[0]?.accessCount).toBe(0);
    expect(digest.entries[0]?.lastAccessed).toBeNull();
  });

  it("returns the seed but writes nothing when distill is discarded", async () => {
    const worker = createCompactionWorker({
      userDataDir: dir,
      runDistill: () =>
        Promise.resolve({
          text: "garbage",
          usage: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
        }),
      hashSources: () => "x",
      newId: () => "id",
      now: () => 1,
      onCost: () => {},
    });
    const result = await worker.compact({
      companyId: "co_1",
      projectId: "pr_1",
      agentId: "ag_1",
      transcript: "x",
    });
    expect(result.taskState).toBe("");
    expect(readDigest(dir, "co_1", "pr_1").entries).toHaveLength(0);
  });
});
