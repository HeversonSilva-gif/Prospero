import { describe, expect, it } from "vitest";
import { buildSpawnEnv, buildSpawnEnvApiKey } from "../src/orchestrator/env.js";
import type { Agent } from "@prospero/shared";

const baseAgent = (): Agent => ({
  id: "ag_1",
  companyId: "co_1",
  name: "n",
  role: "r",
  systemPrompt: "s",
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
});

describe("buildSpawnEnv", () => {
  it("propagates oauth + agent + company", () => {
    const env = buildSpawnEnv(
      {
        id: "agent_x",
        companyId: "co_y",
        name: "n",
        role: "r",
        systemPrompt: "s",
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
      },
      "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123",
      "/tmp/db/prospero.db",
      "/tmp/perm",
      "/tmp/events",
    );
    expect(env.AGENT_ID).toBe("agent_x");
    expect(env.COMPANY_ID).toBe("co_y");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN.startsWith("sk-ant-oat")).toBe(true);
    expect(env.DB_PATH).toBe("/tmp/db/prospero.db");
    expect(env.PERMISSIONS_DIR).toBe("/tmp/perm");
    expect(env.EVENTS_DIR).toBe("/tmp/events");
  });
});

describe("buildSpawnEnvApiKey", () => {
  it("sets ANTHROPIC_API_KEY and omits CLAUDE_CODE_OAUTH_TOKEN", () => {
    const env = buildSpawnEnvApiKey(baseAgent(), "sk-ant-api03-XXXX", "/db", "/perms", "/ev");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-api03-XXXX");
    expect("CLAUDE_CODE_OAUTH_TOKEN" in env).toBe(false);
    expect(env.AGENT_ID).toBe("ag_1");
    expect(env.COMPANY_ID).toBe("co_1");
    expect(env.DB_PATH).toBe("/db");
    expect(env.PERMISSIONS_DIR).toBe("/perms");
    expect(env.EVENTS_DIR).toBe("/ev");
  });
});
