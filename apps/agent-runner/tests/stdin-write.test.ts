import { describe, expect, it } from "vitest";
import { WireHandlerError } from "@prospero/shared";
import { handleStdinWrite } from "../src/handlers/stdin-write.js";
import { createRunnerState } from "../src/state.js";
import { FakeClaude } from "./fake-claude.js";

describe("handleStdinWrite", () => {
  it("writes the line to the agent's stdin", () => {
    const state = createRunnerState();
    const fake = new FakeClaude();
    state.agents.set("agent_1", {
      child: fake,
      sandbox: { configDir: "/c", workDir: "/w" },
      mcp: { port: 0, writeToBridge: () => {}, close: () => {} },
    });
    handleStdinWrite({ agentId: "agent_1", line: '{"type":"user"}\n' }, state);
    expect(fake.stdinWrites).toEqual(['{"type":"user"}\n']);
  });

  it("throws agentNotFound (1010) for an unknown agent", () => {
    let caught: unknown;
    try {
      handleStdinWrite({ agentId: "ghost", line: "x" }, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireHandlerError);
    expect((caught as WireHandlerError).code).toBe(1010);
  });

  it("throws protocolMismatch (1030) on malformed params", () => {
    let caught: unknown;
    try {
      handleStdinWrite({ agentId: "agent_1" }, createRunnerState());
    } catch (e) {
      caught = e;
    }
    expect((caught as WireHandlerError).code).toBe(1030);
  });
});
