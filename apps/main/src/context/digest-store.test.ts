import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDigest, writeDigest, foldEntries } from "./digest-store.js";
import type { DigestEntry } from "@prospero/shared";

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
  ...over,
});

describe("digest-store", () => {
  it("read on a fresh project returns an empty digest", () => {
    expect(readDigest(dir, "co_1", "pr_1").entries).toEqual([]);
  });

  it("write then read round-trips entries", () => {
    writeDigest(dir, "co_1", "pr_1", { version: 1, entries: [entry()] });
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
});
