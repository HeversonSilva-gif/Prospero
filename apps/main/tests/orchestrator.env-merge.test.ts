import { describe, expect, it, afterEach, vi } from "vitest";
import { mergeSpawnEnv } from "../src/orchestrator/util/env-merge.js";

describe("mergeSpawnEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/host");
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
  });

  // ── SEC-CRIT-01: credential stripping from host env ──────────────────────

  it("strips CLAUDE_CODE_OAUTH_TOKEN from host process.env (SEC-CRIT-01)", () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "host-leaked-token");
    // Pass env WITHOUT the token (credentials-seeded path)
    const merged = mergeSpawnEnv(
      { AGENT_ID: "a", COMPANY_ID: "c", DB_PATH: "/x", PERMISSIONS_DIR: "/p", EVENTS_DIR: "/e" },
      "/cfg",
    );
    // The host-leaked token must NOT appear in the merged env
    expect(merged["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
  });

  it("strips ANTHROPIC_API_KEY from host process.env (SEC-CRIT-01)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api-leaked");
    const merged = mergeSpawnEnv(
      { AGENT_ID: "a", COMPANY_ID: "c", DB_PATH: "/x", PERMISSIONS_DIR: "/p", EVENTS_DIR: "/e" },
      "/cfg",
    );
    expect(merged["ANTHROPIC_API_KEY"]).toBeUndefined();
  });

  it("strips ANTHROPIC_AUTH_TOKEN from host process.env (SEC-CRIT-01)", () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "leaked-auth-token");
    const merged = mergeSpawnEnv(
      { AGENT_ID: "a", COMPANY_ID: "c", DB_PATH: "/x", PERMISSIONS_DIR: "/p", EVENTS_DIR: "/e" },
      "/cfg",
    );
    expect(merged["ANTHROPIC_AUTH_TOKEN"]).toBeUndefined();
  });

  it("preserves token when explicitly passed via env (credentials-not-seeded path)", () => {
    // When credentials seeding fails, the adapter passes the token explicitly.
    // mergeSpawnEnv must include it from the env argument even if the host also
    // has it set — the explicit arg always wins (spread order: base, then env).
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "host-token");
    const merged = mergeSpawnEnv(
      {
        CLAUDE_CODE_OAUTH_TOKEN: "explicit-token",
        AGENT_ID: "a",
        COMPANY_ID: "c",
        DB_PATH: "/x",
        PERMISSIONS_DIR: "/p",
        EVENTS_DIR: "/e",
      },
      "/cfg",
    );
    // Explicit env wins over the now-stripped host var
    expect(merged["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("explicit-token");
  });
});
