import { describe, expect, it } from "vitest";
import { DEFAULT_ADAPTER_NAME, type AdapterName } from "../src/types/adapter.js";

describe("adapter types", () => {
  it("exports DEFAULT_ADAPTER_NAME='claude-oauth-local'", () => {
    expect(DEFAULT_ADAPTER_NAME).toBe("claude-oauth-local");
  });

  it("AdapterName accepts the three v1 names", () => {
    const names: AdapterName[] = [
      "claude-oauth-local",
      "claude-api-key-local",
      "claude-oauth-remote-docker",
    ];
    expect(names).toHaveLength(3);
  });
});

describe("AdapterName includes claude-api-direct", () => {
  it("accepts claude-api-direct as a valid adapter name", () => {
    const n: AdapterName = "claude-api-direct";
    expect(n).toBe("claude-api-direct");
  });
});
