import { describe, it, expect } from "vitest";
import { renderProjectContextBlock } from "./system-prompt-project-context.js";
import type { DigestEntry } from "@prospero/shared";

const e = (over: Partial<DigestEntry> = {}): DigestEntry => ({
  id: "e1",
  section: "architecture",
  body: "Electron monorepo with apps/main + apps/renderer.",
  sourceFiles: ["package.json"],
  contentHash: "h",
  derivedAt: Date.now(),
  trust: 0.8,
  accessCount: 0,
  lastAccessed: null,
  ...over,
});

describe("renderProjectContextBlock", () => {
  it("returns undefined when there are no entries", () => {
    expect(renderProjectContextBlock([], 4096)).toBeUndefined();
  });

  it("groups entries under section headers", () => {
    const out = renderProjectContextBlock(
      [
        { ...e(), stale: false },
        { ...e({ section: "gotchas", body: "better-sqlite3 ABI" }), stale: false },
      ],
      4096,
    )!;
    expect(out).toContain("# Project context");
    expect(out).toContain("Electron monorepo");
    expect(out).toContain("better-sqlite3 ABI");
  });

  it("marks stale entries", () => {
    const out = renderProjectContextBlock([{ ...e(), stale: true }], 4096)!;
    expect(out.toLowerCase()).toContain("possibly stale");
  });

  it("respects the character cap", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...e({ id: `e${i}`, body: `fact ${i} ` + "x".repeat(50) }),
      stale: false,
    }));
    const out = renderProjectContextBlock(many, 500)!;
    expect(out.length).toBeLessThanOrEqual(700); // cap + header overhead
  });

  it("does not emit empty section headers when the cap cuts a later section", () => {
    const entries = [
      { ...e({ section: "architecture", body: "A".repeat(80) }), stale: false },
      { ...e({ id: "g", section: "gotchas", body: "G".repeat(80) }), stale: false },
    ];
    // cap lets the architecture line fit but not the gotchas line
    const out = renderProjectContextBlock(entries, 150)!;
    expect(out).toContain("## Architecture");
    expect(out).not.toContain("## Gotchas");
  });

  it("drops entries whose decayed trust is below the floor", () => {
    const old = {
      ...e(),
      stale: false,
      trust: 0.5,
      accessCount: 0,
      derivedAt: 0,
      lastAccessed: null,
    };
    // derivedAt=0 (epoch) → huge elapsed → decayed trust ~0 → dropped
    const out = renderProjectContextBlock([old], 4096, 1_000_000_000_000);
    expect(out).toBeUndefined();
  });

  it("keeps a fresh, recently-derived entry", () => {
    const now = 1_000_000_000_000;
    const cur = {
      ...e(),
      stale: false,
      trust: 0.8,
      accessCount: 0,
      derivedAt: now,
      lastAccessed: null,
    };
    const out = renderProjectContextBlock([cur], 4096, now)!;
    expect(out).toContain("Electron monorepo");
  });
});
