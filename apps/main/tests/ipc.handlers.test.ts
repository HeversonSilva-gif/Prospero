import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/ipc/handlers.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

describe("registerIpcHandlers", () => {
  it("registers ping handler that returns 'pong'", async () => {
    handlers.clear();
    registerIpcHandlers();
    const ping = handlers.get("ping");
    expect(ping).toBeDefined();
    const result = await Promise.resolve(ping!({}));
    expect(result).toBe("pong");
  });
});
