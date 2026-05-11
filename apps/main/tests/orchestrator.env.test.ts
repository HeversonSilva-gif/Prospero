import { describe, expect, it } from "vitest";
import { buildSpawnEnv } from "../src/orchestrator/env.js";

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
      },
      "sk-ant-oat-PRODUCTION_TOKEN_VALUE_HERE_xyz123",
      "/tmp/db/dashboard-agent.db",
      "/tmp/perm",
      "/tmp/events",
    );
    expect(env.AGENT_ID).toBe("agent_x");
    expect(env.COMPANY_ID).toBe("co_y");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN.startsWith("sk-ant-oat")).toBe(true);
    expect(env.DB_PATH).toBe("/tmp/db/dashboard-agent.db");
    expect(env.PERMISSIONS_DIR).toBe("/tmp/perm");
    expect(env.EVENTS_DIR).toBe("/tmp/events");
  });
});
