import { describe, it, expect } from "vitest";
import { parseProposals } from "./parse-proposals.js";

const known = new Set(["s1", "s2", "s3"]);

describe("parseProposals", () => {
  it("parses a valid merge proposal", () => {
    const text = JSON.stringify([
      {
        kind: "merge",
        sourceSkillIds: ["s1", "s2"],
        name: "m",
        description: "d",
        body: "b",
        rationale: "overlap",
      },
    ]);
    const out = parseProposals(text, known);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("merge");
  });
  it("discards entries referencing unknown skill ids", () => {
    const text = JSON.stringify([{ kind: "archive", sourceSkillIds: ["nope"], rationale: "x" }]);
    expect(parseProposals(text, known)).toHaveLength(0);
  });
  it("discards merge without body/name", () => {
    expect(
      parseProposals(
        JSON.stringify([{ kind: "merge", sourceSkillIds: ["s1", "s2"], rationale: "x" }]),
        known,
      ),
    ).toHaveLength(0);
  });
  it("discards merge with fewer than 2 source ids", () => {
    expect(
      parseProposals(
        JSON.stringify([
          { kind: "merge", sourceSkillIds: ["s1"], name: "m", body: "b", rationale: "x" },
        ]),
        known,
      ),
    ).toHaveLength(0);
  });
  it("returns [] for non-JSON or non-array", () => {
    expect(parseProposals("not json", known)).toEqual([]);
    expect(parseProposals(JSON.stringify({}), known)).toEqual([]);
  });
  it("tolerates a fenced ```json block", () => {
    const text =
      "```json\n" +
      JSON.stringify([{ kind: "archive", sourceSkillIds: ["s3"], rationale: "stale" }]) +
      "\n```";
    expect(parseProposals(text, known)).toHaveLength(1);
  });
});
