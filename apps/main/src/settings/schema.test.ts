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
