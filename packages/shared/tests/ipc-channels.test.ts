import { describe, expect, it } from "vitest";
import { IPC } from "../src/ipc-channels.js";

describe("IPC channels", () => {
  it("exposes a 'ping' channel", () => {
    expect(IPC.PING).toBe("ping");
  });

  it("channel names are unique", () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
  });

  it("channel names use lowercase-kebab-case namespacing", () => {
    for (const v of Object.values(IPC)) {
      expect(v).toMatch(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$/);
    }
  });
});
