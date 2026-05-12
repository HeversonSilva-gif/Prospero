import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent } from "@dashboard-agent/shared";
import { createCurrentActionDebouncer } from "../src/orchestrator/event-throttle.js";
import { mapToolUseToAction } from "../src/orchestrator/current-action-mapper.js";

// Behaviour-oriented test of the broadcast contract used inside ensureAgentRunner.
// We don't boot Electron — we exercise the pure pieces (debouncer + mapper) that
// the handler composes.

describe("broadcast deltas (mapper + debouncer)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("multiple tool_use blocks in the same turn coalesce into a single current-action-changed", () => {
    const events: AgentEvent[] = [];
    const emit = (agentId: string, action: string | null): void => {
      events.push({ kind: "current-action-changed", agentId, action });
    };
    const d = createCurrentActionDebouncer(emit, 200);

    for (const tool of [
      { name: "Read", input: { file_path: "/p/a.ts" } },
      { name: "Read", input: { file_path: "/p/b.ts" } },
      { name: "Bash", input: { command: "ls" } },
    ]) {
      d.schedule("agent_1", mapToolUseToAction(tool.name, tool.input));
    }
    vi.advanceTimersByTime(200);
    expect(events).toEqual([
      { kind: "current-action-changed", agentId: "agent_1", action: "Running shell" },
    ]);
  });

  it("turn-complete flush emits null without waiting full window", () => {
    const events: AgentEvent[] = [];
    const emit = (agentId: string, action: string | null): void => {
      events.push({ kind: "current-action-changed", agentId, action });
    };
    const d = createCurrentActionDebouncer(emit, 200);
    d.schedule("agent_1", mapToolUseToAction("Read", { file_path: "/p/a.ts" }));
    d.schedule("agent_1", null);
    d.flush("agent_1");
    expect(events).toEqual([{ kind: "current-action-changed", agentId: "agent_1", action: null }]);
  });
});
