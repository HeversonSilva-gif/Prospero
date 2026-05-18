import { describe, it, expect } from "vitest";
import { validateCharter } from "@prospero/shared";
import { SEED_CHARTERS } from "./seed-charters.js";

describe("SEED_CHARTERS", () => {
  it("covers exactly the 5 canonical role ids", () => {
    expect(Object.keys(SEED_CHARTERS).sort()).toEqual([
      "role-ceo",
      "role-designer",
      "role-engineer",
      "role-pm",
      "role-qa",
    ]);
  });

  it("every seed charter passes the 8-section validator", () => {
    for (const [roleId, body] of Object.entries(SEED_CHARTERS)) {
      const result = validateCharter(body);
      expect(result.missing, `${roleId} is missing sections`).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("every seed charter is substantial (> 1 KB)", () => {
    for (const [roleId, body] of Object.entries(SEED_CHARTERS)) {
      expect(body.length, `${roleId} too short`).toBeGreaterThan(1024);
    }
  });
});
