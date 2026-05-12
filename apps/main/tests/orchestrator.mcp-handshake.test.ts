import { describe, expect, it } from "vitest";
import { resolveMcpServerPath } from "../src/orchestrator/mcp-handshake.js";

describe("resolveMcpServerPath", () => {
  it("uses override when provided", () => {
    expect(resolveMcpServerPath("/custom/path.js")).toBe("/custom/path.js");
  });

  it("falls back to dist/mcp/server.js relative path when no override", () => {
    const result = resolveMcpServerPath();
    expect(result.endsWith("mcp/server.js") || result.endsWith("mcp\\server.js")).toBe(true);
  });
});
