import { describe, expect, it } from "vitest";
import { WireHandlerError } from "@dashboard-agent/shared";
import { handleHandshake } from "../src/handlers/handshake.js";
import { createRunnerState } from "../src/state.js";

const validParams = {
  protocolVersion: 1,
  client: "dashboard-agent",
  clientVersion: "0.10.0",
  credentials: { kind: "oauth", oauthToken: "tok-123" },
};

describe("handleHandshake", () => {
  it("returns the server handshake result for a valid handshake", () => {
    const result = handleHandshake(validParams, createRunnerState());
    expect(result).toEqual({
      protocolVersion: 1,
      server: "agent-runner",
      serverVersion: "0.1.0",
      capabilities: ["health"],
    });
  });

  it("records the credentials on the runner state", () => {
    const state = createRunnerState();
    handleHandshake(validParams, state);
    expect(state.credentials).toEqual({ kind: "oauth", oauthToken: "tok-123" });
  });

  it("throws unsupportedProtocol (1000) on a version mismatch", () => {
    let caught: unknown;
    try {
      handleHandshake({ ...validParams, protocolVersion: 99 }, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1000);
  });

  it("throws unsupportedCredentials (1001) on a non-oauth credential kind", () => {
    let caught: unknown;
    try {
      handleHandshake(
        { ...validParams, credentials: { kind: "api-key", oauthToken: "x" } },
        createRunnerState(),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1001);
  });

  it("throws protocolMismatch (1030) on malformed params", () => {
    let caught: unknown;
    try {
      handleHandshake({ protocolVersion: 1 }, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
