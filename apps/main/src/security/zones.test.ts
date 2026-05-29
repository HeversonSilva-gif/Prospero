import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { zoneOf, canAccess } from "./zones.js";
import type { Agent } from "@prospero/shared";

const ROOT = "/tmp/prospero-userdata";

const agentInCompany = (companyId: string, agentId: string): Agent =>
  ({ id: agentId, companyId }) as Agent; // cast — tests only need these two fields

describe("zoneOf", () => {
  // ── companies/<cid>/... tree ──────────────────────────────────────────────

  it("classifies <userData>/companies/<cid>/<file> as company zone", () => {
    expect(zoneOf(join(ROOT, "companies", "c1", "telos.md"), ROOT)).toEqual({
      kind: "company",
      companyId: "c1",
    });
  });

  it("classifies <userData>/companies/<cid>/goals/<gid>/... as company zone (goals live under the company)", () => {
    expect(zoneOf(join(ROOT, "companies", "c1", "goals", "g1", "isa.md"), ROOT)).toEqual({
      kind: "company",
      companyId: "c1",
    });
  });

  it("classifies <userData>/companies/<cid>/agents/<aid>/<file> as agent zone", () => {
    expect(zoneOf(join(ROOT, "companies", "c1", "agents", "a1", "charter.md"), ROOT)).toEqual({
      kind: "agent",
      companyId: "c1",
      agentId: "a1",
    });
  });

  it("classifies a deeper file inside the agent directory (companies tree) as agent zone", () => {
    expect(
      zoneOf(join(ROOT, "companies", "c1", "agents", "a1", "instructions", "playbook.md"), ROOT),
    ).toEqual({ kind: "agent", companyId: "c1", agentId: "a1" });
  });

  // ── agent-instructions/<cid>/agents/<aid>/... tree ────────────────────────
  // Real layout: <userData>/agent-instructions/companies/<cid>/agents/<aid>/
  // (M12 PR-C instruction bundles — differs from the plan's assumption)

  it("classifies <userData>/agent-instructions/companies/<cid>/agents/<aid>/<file> as agent zone", () => {
    expect(
      zoneOf(
        join(ROOT, "agent-instructions", "companies", "c1", "agents", "a1", "charter.md"),
        ROOT,
      ),
    ).toEqual({ kind: "agent", companyId: "c1", agentId: "a1" });
  });

  it("classifies a deeper file inside agent-instructions agent directory as agent zone", () => {
    expect(
      zoneOf(
        join(ROOT, "agent-instructions", "companies", "c1", "agents", "a1", "sub", "file.md"),
        ROOT,
      ),
    ).toEqual({ kind: "agent", companyId: "c1", agentId: "a1" });
  });

  // ── memory/companies/<cid>/... tree ───────────────────────────────────────
  // Real layout: <userData>/memory/companies/<cid>/agents/<aid>/
  // (M11 memory — differs from the plan's assumption)

  it("classifies <userData>/memory/companies/<cid>/agents/<aid>/... as agent zone", () => {
    expect(
      zoneOf(join(ROOT, "memory", "companies", "c1", "agents", "a1", "memory.md"), ROOT),
    ).toEqual({ kind: "agent", companyId: "c1", agentId: "a1" });
  });

  it("classifies <userData>/memory/companies/<cid>/<file> as company zone (company-shared memory)", () => {
    expect(zoneOf(join(ROOT, "memory", "companies", "c1", "memory.md"), ROOT)).toEqual({
      kind: "company",
      companyId: "c1",
    });
  });

  // ── unknown / out-of-scope paths ──────────────────────────────────────────

  it("returns null for paths outside userDataDir", () => {
    expect(zoneOf("/some/other/place/file.txt", ROOT)).toBeNull();
  });

  it("returns null for paths inside userDataDir but outside the companies tree", () => {
    expect(zoneOf(join(ROOT, "logs", "app.log"), ROOT)).toBeNull();
  });

  // ── agent-sandbox/<aid>/... (iss_0d783928) ───────────────────────────────

  it("classifies agent-sandbox/<aid> as system zone", () => {
    expect(zoneOf(join(ROOT, "agent-sandbox", "agent-123"), ROOT)).toEqual({ kind: "system" });
  });

  it("classifies agent-sandbox/<aid>/.credentials.json as system zone", () => {
    expect(zoneOf(join(ROOT, "agent-sandbox", "agent-123", ".credentials.json"), ROOT)).toEqual({
      kind: "system",
    });
  });

  it("classifies agent-sandbox/<aid>/cwd as system zone", () => {
    expect(zoneOf(join(ROOT, "agent-sandbox", "agent-123", "cwd"), ROOT)).toEqual({
      kind: "system",
    });
  });

  it("classifies deep path inside agent-sandbox as system zone", () => {
    expect(zoneOf(join(ROOT, "agent-sandbox", "agent-123", "settings.json"), ROOT)).toEqual({
      kind: "system",
    });
  });

  // ── sbx/<slug>/... — the short layout (v0.1.38 MAX_PATH fix) ──────────────
  it("classifies sbx/<slug> as system zone", () => {
    expect(zoneOf(join(ROOT, "sbx", "2754ee4b0121"), ROOT)).toEqual({ kind: "system" });
  });

  it("classifies sbx/<slug>/.credentials.json as system zone", () => {
    expect(zoneOf(join(ROOT, "sbx", "2754ee4b0121", ".credentials.json"), ROOT)).toEqual({
      kind: "system",
    });
  });

  it("classifies sbx/<slug>/c (the agent CWD) as system zone", () => {
    expect(zoneOf(join(ROOT, "sbx", "2754ee4b0121", "c", "anything.txt"), ROOT)).toEqual({
      kind: "system",
    });
  });

  it("still classifies the legacy agent-sandbox/ tree as system (orphan protection)", () => {
    expect(
      zoneOf(join(ROOT, "agent-sandbox", "agent_old-uuid", ".credentials.json"), ROOT),
    ).toEqual({ kind: "system" });
  });

  it("returns null for the companies root itself (no specific company)", () => {
    expect(zoneOf(join(ROOT, "companies"), ROOT)).toBeNull();
  });

  it("returns null for the memory root itself (no specific company)", () => {
    expect(zoneOf(join(ROOT, "memory"), ROOT)).toBeNull();
  });

  it("returns null for the agent-instructions root itself (no specific company)", () => {
    expect(zoneOf(join(ROOT, "agent-instructions"), ROOT)).toBeNull();
  });
});

describe("canAccess", () => {
  it("agent can access its own agent zone", () => {
    expect(
      canAccess(agentInCompany("c1", "a1"), { kind: "agent", companyId: "c1", agentId: "a1" }),
    ).toBe(true);
  });

  it("agent cannot access another agent's zone in the same company (cross-agent)", () => {
    expect(
      canAccess(agentInCompany("c1", "a1"), { kind: "agent", companyId: "c1", agentId: "a2" }),
    ).toBe(false);
  });

  it("agent cannot access another agent's zone in a different company", () => {
    expect(
      canAccess(agentInCompany("c1", "a1"), { kind: "agent", companyId: "c2", agentId: "a1" }),
    ).toBe(false);
  });

  it("agent can access its own company zone", () => {
    expect(canAccess(agentInCompany("c1", "a1"), { kind: "company", companyId: "c1" })).toBe(true);
  });

  it("agent cannot access another company's zone (cross-company)", () => {
    expect(canAccess(agentInCompany("c1", "a1"), { kind: "company", companyId: "c2" })).toBe(false);
  });

  it("system zone is never writable for an agent", () => {
    expect(canAccess(agentInCompany("c1", "a1"), { kind: "system" })).toBe(false);
  });

  it("shared zone is accessible to any agent (read-only at the gate level)", () => {
    expect(canAccess(agentInCompany("c1", "a1"), { kind: "shared" })).toBe(true);
  });
});
