import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderProjectContextBlock,
  buildAgentContextBlock,
  buildProjectContextBlock,
} from "./system-prompt-project-context.js";
import { writeDigestAt, readDigestAt, readDigest } from "../context/digest-store.js";
import { agentDigestPath, projectDigestPath } from "../context/digest-dir.js";
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

describe("buildAgentContextBlock", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agctx-"));
  });

  it("returns undefined when the agent has no digest", () => {
    expect(
      buildAgentContextBlock({ userDataDir: dir, companyId: "co_1", agentId: "ag_1" }),
    ).toBeUndefined();
  });

  it("renders the agent digest WITHOUT file-based staleness (no repo root)", () => {
    writeDigestAt(agentDigestPath(dir, "co_1", "ag_1"), {
      version: 1,
      entries: [
        // sourceFiles empty + no real repo: a file-hashing builder would mark
        // this stale; the agent builder must not.
        { ...e({ body: "CEO prioritizes revenue.", sourceFiles: [] }) },
      ],
      deepDives: [],
    });
    const out = buildAgentContextBlock({ userDataDir: dir, companyId: "co_1", agentId: "ag_1" })!;
    expect(out).toContain("# Project context");
    expect(out).toContain("CEO prioritizes revenue.");
    expect(out.toLowerCase()).not.toContain("possibly stale");
  });

  // Audit 2026-06-03 Inteligência & Contexto I6: entries injected into the
  // prompt must bump accessCount, or they decay at the base half-life and age
  // out regardless of how often they are used.
  it("bumps accessCount for agent digest entries it injects", () => {
    writeDigestAt(agentDigestPath(dir, "co_1", "ag_1"), {
      version: 1,
      entries: [{ ...e({ id: "agX", body: "CEO prioritizes revenue.", accessCount: 0 }) }],
      deepDives: [],
    });
    buildAgentContextBlock({ userDataDir: dir, companyId: "co_1", agentId: "ag_1" });
    const persisted = readDigestAt(agentDigestPath(dir, "co_1", "ag_1"));
    expect(persisted.entries.find((x) => x.id === "agX")!.accessCount).toBe(1);
    expect(persisted.entries.find((x) => x.id === "agX")!.lastAccessed).not.toBeNull();
  });
});

describe("buildProjectContextBlock", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prjctx-"));
  });

  // Audit 2026-06-03 Inteligência & Contexto I6.
  it("bumps accessCount for project digest entries it injects", () => {
    writeDigestAt(projectDigestPath(dir, "co_1", "pr_1"), {
      version: 1,
      // sourceFiles empty → freshness hash matches "" content path consistently;
      // entry stays live and gets rendered.
      entries: [{ ...e({ id: "prX", body: "monorepo layout", sourceFiles: [], accessCount: 0 }) }],
      deepDives: [],
    });
    buildProjectContextBlock({
      userDataDir: dir,
      companyId: "co_1",
      projectId: "pr_1",
      projectPath: dir, // any path; the entry has no sourceFiles
    });
    const persisted = readDigest(dir, "co_1", "pr_1");
    expect(persisted.entries.find((x) => x.id === "prX")!.accessCount).toBe(1);
  });

  it("does NOT bump accessCount for an entry it drops (decayed below floor)", () => {
    writeDigestAt(projectDigestPath(dir, "co_1", "pr_1"), {
      version: 1,
      entries: [
        {
          ...e({
            id: "dead",
            body: "old",
            sourceFiles: [],
            trust: 0.5,
            derivedAt: 0,
            accessCount: 0,
          }),
        },
      ],
      deepDives: [],
    });
    buildProjectContextBlock({
      userDataDir: dir,
      companyId: "co_1",
      projectId: "pr_1",
      projectPath: dir,
    });
    const persisted = readDigest(dir, "co_1", "pr_1");
    // derivedAt=0 → decayed below floor → not rendered → no access bump.
    expect(persisted.entries.find((x) => x.id === "dead")!.accessCount).toBe(0);
  });
});
