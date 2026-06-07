import { describe, expect, it } from "vitest";
import { isAuthConnected } from "./auth-connected.js";

describe("isAuthConnected", () => {
  it("oauth mode: connected when the OAuth token is present", () => {
    expect(isAuthConnected("oauth", { hasToken: true }, { hasKey: false })).toBe(true);
  });

  it("oauth mode: NOT connected on an API key alone (oauth ignores the key)", () => {
    expect(isAuthConnected("oauth", { hasToken: false }, { hasKey: true })).toBe(false);
  });

  it("oauth mode: NOT connected with neither", () => {
    expect(isAuthConnected("oauth", { hasToken: false }, { hasKey: false })).toBe(false);
  });

  it("api-key mode: connected when the API key is present (no OAuth token needed)", () => {
    expect(isAuthConnected("api-key", { hasToken: false }, { hasKey: true })).toBe(true);
  });

  it("api-key mode: NOT connected on an OAuth token alone (api-key ignores the token)", () => {
    expect(isAuthConnected("api-key", { hasToken: true }, { hasKey: false })).toBe(false);
  });

  it("api-key mode: NOT connected with neither", () => {
    expect(isAuthConnected("api-key", { hasToken: false }, { hasKey: false })).toBe(false);
  });
});
