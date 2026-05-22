import { describe, expect, it } from "vitest";
import { ClaudeApiKeyLocalAdapter } from "./adapter.js";
import type { Agent, SpawnContext } from "@prospero/shared";

const baseAgent = (): Agent => ({
  id: "ag_1",
  companyId: "co_1",
  name: "Test",
  role: "engineer",
  systemPrompt: "p",
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
  adapterName: "claude-api-key-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
  autoModeSetAt: null,
});

describe("ClaudeApiKeyLocalAdapter", () => {
  it("constructor sets name + agentId", () => {
    const ctx: SpawnContext = {
      agent: baseAgent(),
      apiKey: "sk-ant-api03-XXX",
      dbPath: "/db",
      permissionsDir: "/perms",
      eventsDir: "/ev",
    };
    const adapter = new ClaudeApiKeyLocalAdapter(ctx);
    expect(adapter.name).toBe("claude-api-key-local");
    expect(adapter.agentId).toBe("ag_1");
  });

  it("start() throws when apiKey absent", async () => {
    const ctx: SpawnContext = {
      agent: baseAgent(),
      dbPath: "/db",
      permissionsDir: "/perms",
      eventsDir: "/ev",
    };
    const adapter = new ClaudeApiKeyLocalAdapter(ctx);
    await expect(adapter.start()).rejects.toThrow(/apiKey/);
  });
});
