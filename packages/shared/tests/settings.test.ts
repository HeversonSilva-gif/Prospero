import { describe, expect, it } from "vitest";
import { IPC, type AppSettings, type TokenStatus, type TokenSource } from "../src/index.js";

describe("settings types and channels", () => {
  it("defines settings IPC channels", () => {
    expect(IPC.SETTINGS_GET).toBe("settings:get");
    expect(IPC.SETTINGS_UPDATE).toBe("settings:update");
  });

  it("defines auth IPC channels", () => {
    expect(IPC.AUTH_TOKEN_STATUS).toBe("auth:token-status");
    expect(IPC.AUTH_TOKEN_SET).toBe("auth:token-set");
    expect(IPC.AUTH_TOKEN_DETECT).toBe("auth:token-detect");
    expect(IPC.AUTH_TOKEN_CLEAR).toBe("auth:token-clear");
  });

  it("AppSettings is structurally constructable", () => {
    const s: AppSettings = {
      language: "pt-BR",
      theme: "light",
      workspaceCwd: null,
      defaultModelForNewAgents: "claude-sonnet-4-6",
    };
    expect(s.language).toBe("pt-BR");
    expect(s.theme).toBe("light");
  });

  it("TokenStatus reflects empty state", () => {
    const s: TokenStatus = { hasToken: false };
    expect(s.hasToken).toBe(false);
  });

  it("TokenSource enumerates manual + auto-detect", () => {
    const a: TokenSource = "manual";
    const b: TokenSource = "auto-detect";
    expect(a).toBe("manual");
    expect(b).toBe("auto-detect");
  });
});
