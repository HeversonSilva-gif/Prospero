import { describe, expect, it } from "vitest";
import { createRunnerState } from "../src/state.js";

describe("createRunnerState", () => {
  it("starts with no credentials", () => {
    const state = createRunnerState();
    expect(state.credentials).toBeNull();
  });

  it("records the given start time", () => {
    const state = createRunnerState(1000);
    expect(state.startedAt).toBe(1000);
  });

  it("defaults the start time to now", () => {
    const before = Date.now();
    const state = createRunnerState();
    expect(state.startedAt).toBeGreaterThanOrEqual(before);
  });

  it("starts with an empty agents registry", () => {
    const state = createRunnerState();
    expect(state.agents.size).toBe(0);
  });
});
