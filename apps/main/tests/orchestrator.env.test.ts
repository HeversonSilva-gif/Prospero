import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../src/orchestrator/env.js";

describe("buildSpawnEnv", () => {
  it("propagates oauth + agent + company and generates mcp token", () => {
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
      },
      "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123",
    );
    expect(env.AGENT_ID).toBe("agent_x");
    expect(env.COMPANY_ID).toBe("co_y");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN.startsWith("sk-ant-oat")).toBe(true);
    expect(env.MCP_TOKEN.length).toBe(64); // 32 bytes hex
  });

  it("generates unique MCP_TOKEN per call", () => {
    const agent = {
      id: "a",
      companyId: "c",
      name: "n",
      role: "r",
      systemPrompt: "s",
      mode: "supervised" as const,
      alwaysOn: false,
      status: "idle" as const,
      claudeSessionId: null,
      currentAction: null,
    };
    const e1 = buildSpawnEnv(agent, "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_a");
    const e2 = buildSpawnEnv(agent, "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_b");
    expect(e1.MCP_TOKEN).not.toBe(e2.MCP_TOKEN);
  });
});
