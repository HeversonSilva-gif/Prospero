import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapterRegistry, createAdapter } from "../src/orchestrator/adapters/index.js";
import { ClaudeOAuthLocalAdapter } from "../src/orchestrator/adapters/claude-oauth-local/adapter.js";
import type { Agent, SpawnContext } from "@prospero/shared";

const baseAgent: Agent = {
  id: "a1",
  companyId: "c1",
  name: "X",
  role: "Y",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
};

const baseCtx = (): SpawnContext => ({
  agent: baseAgent,
  oauthToken: "t",
  dbPath: join(tmpdir(), "x.db"),
  permissionsDir: mkdtempSync(join(tmpdir(), "p-")),
  eventsDir: mkdtempSync(join(tmpdir(), "e-")),
});

describe("adapterRegistry", () => {
  it("exposes claude-oauth-local factory", () => {
    expect(adapterRegistry["claude-oauth-local"]).toBeDefined();
    expect(adapterRegistry["claude-oauth-local"]?.name).toBe("claude-oauth-local");
  });

  it("createAdapter returns a ClaudeOAuthLocalAdapter for default name", () => {
    const a = createAdapter("claude-oauth-local", baseCtx());
    expect(a).toBeInstanceOf(ClaudeOAuthLocalAdapter);
    expect(a.name).toBe("claude-oauth-local");
  });

  it("createAdapter throws on unknown name", () => {
    expect(() => createAdapter("claude-bogus-name" as never, baseCtx())).toThrow();
  });
});
