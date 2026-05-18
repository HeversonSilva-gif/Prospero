import { describe, it, expect } from "vitest";
import {
  OPERATING_MANUAL,
  OPERATING_MANUAL_NAME,
  OPERATING_MANUAL_DESCRIPTION,
} from "./operating-manual.js";

describe("operating-manual", () => {
  it("has a kebab-case name", () => {
    expect(OPERATING_MANUAL_NAME).toMatch(/^[a-z0-9-]+$/);
  });

  it("has an L0 description within the 200-char skill description cap", () => {
    expect(OPERATING_MANUAL_DESCRIPTION.length).toBeGreaterThan(0);
    expect(OPERATING_MANUAL_DESCRIPTION.length).toBeLessThanOrEqual(200);
  });

  it("ships a substantial body covering every core section", () => {
    expect(OPERATING_MANUAL.length).toBeGreaterThan(1024);
    for (const heading of [
      "issue lifecycle",
      "artifacts",
      "delegation protocol",
      "cost discipline",
      "goal-plan mechanics",
      "conventions",
    ]) {
      expect(OPERATING_MANUAL.toLowerCase()).toContain(heading);
    }
  });

  it("body stays under the 16 KB skill_read body cap", () => {
    expect(OPERATING_MANUAL.length).toBeLessThanOrEqual(16_384);
  });
});
