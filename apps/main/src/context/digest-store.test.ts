import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readDigest,
  writeDigest,
  foldEntries,
  foldDeepDives,
  bumpEntryAccess,
} from "./digest-store.js";
import type { DigestEntry, DeepDive } from "@prospero/shared";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "digest-"));
});

const entry = (over: Partial<DigestEntry> = {}): DigestEntry => ({
  id: "e1",
  section: "architecture",
  body: "It is an Electron monorepo.",
  sourceFiles: ["package.json"],
  contentHash: "h1",
  derivedAt: 1,
  trust: 0.5,
  accessCount: 0,
  lastAccessed: null,
  ...over,
});

describe("digest-store", () => {
  it("read on a fresh project returns an empty digest", () => {
    expect(readDigest(dir, "co_1", "pr_1").entries).toEqual([]);
  });

  it("write then read round-trips entries", () => {
    writeDigest(dir, "co_1", "pr_1", { version: 1, entries: [entry()], deepDives: [] });
    const d = readDigest(dir, "co_1", "pr_1");
    expect(d.entries[0]?.body).toBe("It is an Electron monorepo.");
  });

  it("foldEntries replaces an entry with the same section+sourceFiles", () => {
    const base = [entry({ id: "old", body: "old", contentHash: "h1" })];
    const incoming = [entry({ id: "new", body: "new", contentHash: "h2" })];
    const merged = foldEntries(base, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toBe("new");
    expect(merged[0]?.id).toBe("new");
  });

  it("foldEntries appends entries with a different source set", () => {
    const base = [entry({ sourceFiles: ["a.ts"] })];
    const incoming = [entry({ id: "e2", sourceFiles: ["b.ts"] })];
    expect(foldEntries(base, incoming)).toHaveLength(2);
  });

  it("readDigest fills missing trust/accessCount/deepDives defaults", () => {
    writeDigest(dir, "co_1", "pr_x", {
      version: 1,
      entries: [
        // @ts-expect-error legacy shape without the new fields
        {
          id: "e",
          section: "architecture",
          body: "x",
          sourceFiles: [],
          contentHash: "h",
          derivedAt: 1,
        },
      ],
      deepDives: [],
    });
    const d = readDigest(dir, "co_1", "pr_x");
    expect(d.entries[0]?.trust).toBe(0.5);
    expect(d.entries[0]?.accessCount).toBe(0);
    expect(d.entries[0]?.lastAccessed).toBeNull();
    expect(d.deepDives).toEqual([]);
  });

  it("foldDeepDives upserts by area", () => {
    const mk = (over: Partial<DeepDive>): DeepDive => ({
      id: "d",
      area: "gate",
      body: "old",
      sourceFiles: [],
      contentHash: "h",
      derivedAt: 1,
      trust: 0.5,
      accessCount: 0,
      lastAccessed: null,
      ...over,
    });
    const merged = foldDeepDives(
      [mk({ id: "old", body: "old" })],
      [mk({ id: "new", body: "new" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toBe("new");
  });

  it("bumpEntryAccess increments count and sets lastAccessed", () => {
    const e = {
      id: "e",
      section: "architecture" as const,
      body: "x",
      sourceFiles: [],
      contentHash: "h",
      derivedAt: 1,
      trust: 0.5,
      accessCount: 2,
      lastAccessed: null,
    };
    const bumped = bumpEntryAccess(e, 999);
    expect(bumped.accessCount).toBe(3);
    expect(bumped.lastAccessed).toBe(999);
  });
});
