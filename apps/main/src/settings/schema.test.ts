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
