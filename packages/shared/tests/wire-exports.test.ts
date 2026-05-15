import { describe, expect, it } from "vitest";
import {
  WIRE_PROTOCOL_VERSION,
  WireClient,
  WireServer,
  WireRequestError,
  WireHandlerError,
  encodeWireMessage,
  decodeWireMessage,
  LineFramer,
} from "../src/index.js";

describe("wire protocol public exports", () => {
  it("exposes the wire API from the package root", () => {
    expect(WIRE_PROTOCOL_VERSION).toBe(1);
    expect(typeof WireClient).toBe("function");
    expect(typeof WireServer).toBe("function");
    expect(typeof WireRequestError).toBe("function");
    expect(typeof WireHandlerError).toBe("function");
    expect(typeof encodeWireMessage).toBe("function");
    expect(typeof decodeWireMessage).toBe("function");
    expect(typeof LineFramer).toBe("function");
  });
});
