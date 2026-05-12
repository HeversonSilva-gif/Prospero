import { describe, expect, it } from "vitest";
import { mergeSpawnEnv } from "../src/orchestrator/util/env-merge.js";

describe("mergeSpawnEnv", () => {
  it("includes CLAUDE_CONFIG_DIR override", () => {
    const env = {
      CLAUDE_CODE_OAUTH_TOKEN: "t",
      AGENT_ID: "a",
      COMPANY_ID: "c",
      DB_PATH: "/x",
      PERMISSIONS_DIR: "/p",
      EVENTS_DIR: "/e",
    };
    const merged = mergeSpawnEnv(env, "/cfg");
    expect(merged.CLAUDE_CONFIG_DIR).toBe("/cfg");
    expect(merged.AGENT_ID).toBe("a");
  });

  it("merge order overrides host process.env CLAUDE_CONFIG_DIR with our configDir", () => {
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = "/host";
    try {
      const merged = mergeSpawnEnv(
        {
          CLAUDE_CODE_OAUTH_TOKEN: "t",
          AGENT_ID: "a",
          COMPANY_ID: "c",
          DB_PATH: "/x",
          PERMISSIONS_DIR: "/p",
          EVENTS_DIR: "/e",
        },
        "/sandbox",
      );
      expect(merged.CLAUDE_CONFIG_DIR).toBe("/sandbox");
    } finally {
      if (original !== undefined) process.env.CLAUDE_CONFIG_DIR = original;
      else delete process.env.CLAUDE_CONFIG_DIR;
    }
  });
});
