import { describe, it, expect } from "vitest";
import { ALGORITHM, ALGORITHM_DESCRIPTION, ALGORITHM_NAME } from "./algorithm.js";

describe("algorithm bundled skill", () => {
  it("ALGORITHM_NAME is the kebab-case identifier 'algorithm'", () => {
    expect(ALGORITHM_NAME).toBe("algorithm");
  });

  it("ALGORITHM_DESCRIPTION fits the L0 line (<= 200 chars)", () => {
    expect(ALGORITHM_DESCRIPTION.length).toBeGreaterThan(0);
    expect(ALGORITHM_DESCRIPTION.length).toBeLessThanOrEqual(200);
  });

  it("ALGORITHM body fits the skill_read body cap (<= 16384 chars) and is substantive", () => {
    expect(ALGORITHM.length).toBeGreaterThan(1024);
    expect(ALGORITHM.length).toBeLessThanOrEqual(16384);
  });

  it("ALGORITHM body names all 7 phases as level-2 headings, in order", () => {
    const phases = ["OBSERVE", "THINK", "PLAN", "BUILD", "EXECUTE", "VERIFY", "LEARN"];
    let cursor = 0;
    for (const p of phases) {
      const idx = ALGORITHM.indexOf(`## `, cursor);
      expect(idx, `missing or out-of-order phase ${p}`).toBeGreaterThanOrEqual(0);
      const headingLine = ALGORITHM.slice(idx, ALGORITHM.indexOf("\n", idx));
      expect(headingLine, `phase ${p} expected near offset ${idx}`).toContain(p);
      cursor = idx + 3;
    }
  });

  it("ALGORITHM body instructs VERIFY to call criterion_check before marking done", () => {
    expect(ALGORITHM).toMatch(/criterion_check/);
    expect(ALGORITHM.toLowerCase()).toContain("verify");
  });

  it("ALGORITHM body embeds the hard-to-vary heuristic", () => {
    expect(ALGORITHM.toLowerCase()).toMatch(/hard to vary/);
  });
});
