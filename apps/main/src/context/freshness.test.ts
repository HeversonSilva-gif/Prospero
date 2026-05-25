import { describe, it, expect } from "vitest";
import { hashSources, markFreshness } from "./freshness.js";
import type { DigestEntry } from "@prospero/shared";

const entry = (contentHash: string): DigestEntry => ({
  id: "e1",
  section: "architecture",
  body: "x",
  sourceFiles: ["a.ts"],
  contentHash,
  derivedAt: 1,
  trust: 0.5,
  accessCount: 0,
  lastAccessed: null,
});

describe("freshness", () => {
  it("hashSources is stable and order-independent", () => {
    const read = (f: string): string => (f === "a.ts" ? "AAA" : "BBB");
    const h1 = hashSources(["a.ts", "b.ts"], read);
    const h2 = hashSources(["b.ts", "a.ts"], read);
    expect(h1).toBe(h2);
  });

  it("hashSources marks a missing file rather than throwing", () => {
    const read = (): string => {
      throw new Error("ENOENT");
    };
    expect(() => hashSources(["gone.ts"], read)).not.toThrow();
  });

  it("markFreshness flags an entry whose sources changed as stale", () => {
    const read = (): string => "CHANGED";
    const fresh = markFreshness(entry(hashSources(["a.ts"], () => "ORIGINAL")), read);
    expect(fresh.stale).toBe(true);
  });

  it("markFreshness keeps an unchanged entry fresh", () => {
    const read = (): string => "SAME";
    const h = hashSources(["a.ts"], read);
    expect(markFreshness(entry(h), read).stale).toBe(false);
  });
});
