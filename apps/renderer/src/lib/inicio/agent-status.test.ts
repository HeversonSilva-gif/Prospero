import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { getAgentStatusInfo } from "./agent-status.js";

// Fake t() that returns the key.
const t = ((key: string) => key) as unknown as TFunction;

describe("getAgentStatusInfo", () => {
  it("working returns green dot and i18n key", () => {
    const info = getAgentStatusInfo("working", t);
    expect(info.label).toBe("agentStatus.working");
    expect(info.dotColor).toBe("bg-semantic-success");
  });

  it("thinking returns brand dot", () => {
    const info = getAgentStatusInfo("thinking", t);
    expect(info.dotColor).toBe("bg-brand");
  });

  it("idle returns ink-soft dot", () => {
    const info = getAgentStatusInfo("idle", t);
    expect(info.dotColor).toBe("bg-ink-soft");
  });

  it("waiting returns warning dot", () => {
    const info = getAgentStatusInfo("waiting", t);
    expect(info.label).toBe("agentStatus.waiting");
    expect(info.dotColor).toBe("bg-semantic-warning");
  });

  it("paused returns warning dot", () => {
    const info = getAgentStatusInfo("paused", t);
    expect(info.dotColor).toBe("bg-semantic-warning");
  });

  it("error returns danger dot", () => {
    const info = getAgentStatusInfo("error", t);
    expect(info.dotColor).toBe("bg-semantic-danger");
  });
});
