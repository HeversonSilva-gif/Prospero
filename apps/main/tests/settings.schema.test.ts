import { describe, expect, it } from "vitest";
import { AppSettingsSchema, parseSettings } from "../src/settings/schema.js";
import { DEFAULT_CLAUDE_MODEL } from "@prospero/shared";

describe("settings schema", () => {
  it("accepts valid settings", () => {
    const parsed = AppSettingsSchema.parse({ language: "pt-BR", theme: "light" });
    expect(parsed.language).toBe("pt-BR");
    expect(parsed.theme).toBe("light");
  });

  it("rejects invalid language", () => {
    expect(() => AppSettingsSchema.parse({ language: "fr-FR", theme: "light" })).toThrow();
  });

  it("rejects invalid theme", () => {
    expect(() => AppSettingsSchema.parse({ language: "pt-BR", theme: "neon" })).toThrow();
  });

  it("parseSettings fills defaults for missing fields", () => {
    expect(parseSettings({})).toEqual({
      language: "pt-BR",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
      executorMode: "atomic",
      activeCompanyId: null,
      authMode: "oauth",
      defaultAgentMode: "supervised",
      defaultAlwaysOn: false,
      derivationsPerDayPerAgent: 3,
      compactionCacheReadThreshold: 75_000,
      rateLimitedUntil: null,
      remoteExecution: {
        enabled: false,
        mode: "local-docker",
        vpsHost: "",
        vpsUser: "",
        vpsKeyPath: "",
      },
    });
  });

  it("parseSettings preserves valid partial input", () => {
    expect(parseSettings({ theme: "dark" })).toEqual({
      language: "pt-BR",
      theme: "dark",
      workspaceCwd: null,
      defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
      executorMode: "atomic",
      activeCompanyId: null,
      authMode: "oauth",
      defaultAgentMode: "supervised",
      defaultAlwaysOn: false,
      derivationsPerDayPerAgent: 3,
      compactionCacheReadThreshold: 75_000,
      rateLimitedUntil: null,
      remoteExecution: {
        enabled: false,
        mode: "local-docker",
        vpsHost: "",
        vpsUser: "",
        vpsKeyPath: "",
      },
    });
  });

  it("parseSettings drops unknown keys", () => {
    expect(parseSettings({ language: "en-US", garbage: "ignored" })).toEqual({
      language: "en-US",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: DEFAULT_CLAUDE_MODEL,
      executorMode: "atomic",
      activeCompanyId: null,
      authMode: "oauth",
      defaultAgentMode: "supervised",
      defaultAlwaysOn: false,
      derivationsPerDayPerAgent: 3,
      compactionCacheReadThreshold: 75_000,
      rateLimitedUntil: null,
      remoteExecution: {
        enabled: false,
        mode: "local-docker",
        vpsHost: "",
        vpsUser: "",
        vpsKeyPath: "",
      },
    });
  });

  it("accepts workspaceCwd null", () => {
    const result = AppSettingsSchema.safeParse({
      language: "pt-BR",
      theme: "light",
      workspaceCwd: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts workspaceCwd absolute path string", () => {
    const result = AppSettingsSchema.safeParse({
      language: "pt-BR",
      theme: "light",
      workspaceCwd: "C:\\Workspace",
    });
    expect(result.success).toBe(true);
  });

  it("parseSettings backwards-compat: missing workspaceCwd defaults to null", () => {
    const merged = parseSettings({ language: "en-US", theme: "dark" });
    expect(merged.workspaceCwd).toBe(null);
    expect(merged.language).toBe("en-US");
  });
});

describe("AppSettingsSchema — defaultModelForNewAgents", () => {
  it("accepts a valid Claude model id", () => {
    const out = parseSettings({
      language: "en-US",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: "claude-opus-4-7",
    });
    expect(out.defaultModelForNewAgents).toBe("claude-opus-4-7");
  });

  it("falls back to DEFAULT_CLAUDE_MODEL when missing", () => {
    const out = parseSettings({ language: "en-US", theme: "light", workspaceCwd: null });
    expect(out.defaultModelForNewAgents).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("rejects model id with shell metacharacters (command injection guard)", () => {
    const out = parseSettings({
      language: "en-US",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: "claude-sonnet-4-6; rm -rf /",
    });
    // Invalid id triggers whole-object parse failure → parseSettings returns full DEFAULT_SETTINGS
    expect(out.defaultModelForNewAgents).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("rejects empty string", () => {
    const out = parseSettings({
      language: "en-US",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: "",
    });
    expect(out.defaultModelForNewAgents).toBe(DEFAULT_CLAUDE_MODEL);
  });
});
