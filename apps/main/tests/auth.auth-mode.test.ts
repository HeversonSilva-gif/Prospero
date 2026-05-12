import { describe, expect, it } from "vitest";
import { getActiveAuthMode } from "../src/auth/auth-mode.js";

describe("getActiveAuthMode", () => {
  it("returns 'oauth' as the only supported mode in M7.5", () => {
    expect(getActiveAuthMode()).toBe("oauth");
  });
});
