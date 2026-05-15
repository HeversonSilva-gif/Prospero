import { describe, expect, it } from "vitest";
import { WireHandlerError } from "@prospero/shared";
import { handleKill } from "../src/handlers/kill.js";
import { createRunnerState } from "../src/state.js";
import { FakeClaude } from "./fake-claude.js";

describe("handleKill", () => {
  it("kills the agent's child process", () => {
    const state = createRunnerState();
    const fake = new FakeClaude();
    state.agents.set("agent_1", {
      child: fake,
      sandbox: { configDir: "/c", workDir: "/w" },
      mcp: { port: 0, writeToBridge: () => {}, close: () => {} },
    });
    handleKill({ agentId: "agent_1" }, state);
    expect(fake.killed).toBe(true);
  });

  it("throws agentNotFound (1010) for an unknown agent", () => {
    let caught: unknown;
    try {
      handleKill({ agentId: "ghost" }, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1010);
  });

  it("throws protocolMismatch (1030) on malformed params", () => {
    let caught: unknown;
    try {
      handleKill({}, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
