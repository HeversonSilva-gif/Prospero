import { describe, expect, it } from "vitest";
import {
  WIRE_PROTOCOL_VERSION,
  WireErrorCode,
  WireMethod,
  type WireMessage,
} from "../src/types/wire-protocol.js";

describe("wire-protocol types", () => {
  it("WIRE_PROTOCOL_VERSION is 1", () => {
    expect(WIRE_PROTOCOL_VERSION).toBe(1);
  });

  it("WireErrorCode carries the documented codes", () => {
    expect(WireErrorCode.unsupportedProtocol).toBe(1000);
    expect(WireErrorCode.unsupportedCredentials).toBe(1001);
    expect(WireErrorCode.agentNotFound).toBe(1010);
    expect(WireErrorCode.spawnFailed).toBe(1020);
    expect(WireErrorCode.protocolMismatch).toBe(1030);
    expect(WireErrorCode.unauthorised).toBe(1040);
    expect(WireErrorCode.internalError).toBe(1090);
  });

  it("WireMethod covers requests and notifications", () => {
    expect(WireMethod.handshake).toBe("handshake");
    expect(WireMethod.spawn).toBe("spawn");
    expect(WireMethod.stdinWrite).toBe("stdin-write");
    expect(WireMethod.kill).toBe("kill");
    expect(WireMethod.health).toBe("health");
    expect(WireMethod.stdout).toBe("stdout");
    expect(WireMethod.stderr).toBe("stderr");
    expect(WireMethod.exit).toBe("exit");
    expect(WireMethod.mcpOpen).toBe("mcp-open");
    expect(WireMethod.mcpData).toBe("mcp-data");
    expect(WireMethod.mcpClose).toBe("mcp-close");
  });

  it("a request envelope is structurally valid", () => {
    const msg: WireMessage = {
      type: "request",
      id: "msg_1",
      method: "spawn",
      params: { agentId: "a1" },
    };
    expect(msg.type).toBe("request");
  });
});
