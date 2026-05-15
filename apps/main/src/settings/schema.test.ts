import { describe, expect, it } from "vitest";
import { parseSettings } from "./schema.js";

describe("parseSettings activeCompanyId", () => {
  it("defaults to null when absent", () => {
    const parsed = parseSettings({});
    expect(parsed.activeCompanyId).toBeNull();
  });

  it("preserves a valid string id", () => {
    const parsed = parseSettings({ activeCompanyId: "co_abc123" });
    expect(parsed.activeCompanyId).toBe("co_abc123");
  });

  it("preserves explicit null", () => {
    const parsed = parseSettings({ activeCompanyId: null });
    expect(parsed.activeCompanyId).toBeNull();
  });
});

describe("parseSettings authMode", () => {
  it("defaults to oauth when absent", () => {
    expect(parseSettings({}).authMode).toBe("oauth");
  });

  it("preserves 'api-key' value", () => {
    expect(parseSettings({ authMode: "api-key" }).authMode).toBe("api-key");
  });

  it("rejects invalid string → defaults restored", () => {
    expect(parseSettings({ authMode: "bogus" }).authMode).toBe("oauth");
  });
});

describe("parseSettings defaultAgentMode", () => {
  it("defaults to supervised when absent", () => {
    expect(parseSettings({}).defaultAgentMode).toBe("supervised");
  });

  it("preserves 'auto' value", () => {
    expect(parseSettings({ defaultAgentMode: "auto" }).defaultAgentMode).toBe("auto");
  });

  it("rejects bogus mode → falls back to supervised", () => {
    expect(parseSettings({ defaultAgentMode: "bogus" }).defaultAgentMode).toBe("supervised");
  });
});

describe("parseSettings defaultAlwaysOn", () => {
  it("defaults to false when absent", () => {
    expect(parseSettings({}).defaultAlwaysOn).toBe(false);
  });

  it("preserves true", () => {
    expect(parseSettings({ defaultAlwaysOn: true }).defaultAlwaysOn).toBe(true);
  });
});

describe("parseSettings remoteExecution", () => {
  it("defaults to disabled local-docker when absent", () => {
    expect(parseSettings({}).remoteExecution).toEqual({
      enabled: false,
      mode: "local-docker",
      vpsHost: "",
      vpsUser: "",
      vpsKeyPath: "",
    });
  });

  it("preserves a valid remote-vps config", () => {
    const remoteExecution = {
      enabled: true,
      mode: "remote-vps" as const,
      vpsHost: "1.2.3.4",
      vpsUser: "deploy",
      vpsKeyPath: "/home/u/.ssh/id_ed25519",
    };
    expect(parseSettings({ remoteExecution }).remoteExecution).toEqual(remoteExecution);
  });

  it("fills nested defaults for a partial remoteExecution object", () => {
    expect(parseSettings({ remoteExecution: { enabled: true } }).remoteExecution).toEqual({
      enabled: true,
      mode: "local-docker",
      vpsHost: "",
      vpsUser: "",
      vpsKeyPath: "",
    });
  });
});
