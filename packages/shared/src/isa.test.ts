import { describe, it, expect } from "vitest";
import { ISA_SECTIONS, ISA_SKELETON, buildIsaSkeleton, validateIsa, getIsaSection } from "./isa.js";

describe("isa module", () => {
  it("has the 8 canonical sections in order", () => {
    expect(ISA_SECTIONS).toEqual([
      "Problem",
      "Vision",
      "Out of Scope",
      "Constraints",
      "Criteria",
      "Verification Plan",
      "Decisions",
      "Changelog",
    ]);
  });

  it("ISA_SKELETON validates by construction", () => {
    expect(validateIsa(ISA_SKELETON)).toEqual({ ok: true, missing: [] });
  });

  it("validateIsa reports missing sections in canonical order", () => {
    const partial = "## Vision\n\nx\n\n## Problem\n\ny";
    const res = validateIsa(partial);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual([
      "Out of Scope",
      "Constraints",
      "Criteria",
      "Verification Plan",
      "Decisions",
      "Changelog",
    ]);
  });

  it("validateIsa tolerates a numeric prefix and is case-insensitive", () => {
    const body = ISA_SECTIONS.map((s, i) => `## ${i + 1}. ${s.toUpperCase()}`).join("\n\n");
    expect(validateIsa(body).ok).toBe(true);
  });

  it("buildIsaSkeleton seeds the Vision section when given vision text", () => {
    const body = buildIsaSkeleton({ vision: "Ship the launch page." });
    expect(getIsaSection(body, "Vision")).toBe("Ship the launch page.");
    expect(getIsaSection(body, "Problem")).toBe("_Describe this section._");
  });

  it("getIsaSection returns one section's body, or null when absent", () => {
    expect(getIsaSection(ISA_SKELETON, "Decisions")).toBe("_Describe this section._");
    expect(getIsaSection(ISA_SKELETON, "Nonexistent")).toBeNull();
  });

  it("getIsaSection returns the ISC placeholder for managed sections", () => {
    const body = getIsaSection(ISA_SKELETON, "Criteria");
    expect(body).toContain("ISCs");
    expect(getIsaSection(ISA_SKELETON, "Verification Plan")).toBe(body);
  });

  it("getIsaSection reads sections from a CRLF document", () => {
    const crlf = ISA_SKELETON.replace(/\n/g, "\r\n");
    expect(getIsaSection(crlf, "Problem")).toBe("_Describe this section._");
  });

  it("validateIsa treats an empty document as all sections missing", () => {
    const result = validateIsa("");
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...ISA_SECTIONS]);
  });
});
