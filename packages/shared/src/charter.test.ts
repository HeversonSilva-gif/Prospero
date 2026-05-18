import { describe, it, expect } from "vitest";
import { CHARTER_SECTIONS, CHARTER_SKELETON, validateCharter } from "./charter.js";

const fullCharter = `# Engineer — Role Charter

${CHARTER_SECTIONS.map((s) => `## ${s}\n\nSome real content for ${s}.`).join("\n\n")}
`;

describe("validateCharter", () => {
  it("accepts a charter with all 8 sections", () => {
    const result = validateCharter(fullCharter);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("reports a missing section", () => {
    const withoutQualityBar = fullCharter.replace("## Quality Bar", "## Standards");
    const result = validateCharter(withoutQualityBar);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["Quality Bar"]);
  });

  it("accepts numbered headings like '## 1. Identity'", () => {
    const numbered = CHARTER_SECTIONS.map((s, i) => `## ${i + 1}. ${s}\n\nbody`).join("\n\n");
    expect(validateCharter(numbered).ok).toBe(true);
  });

  it("matches headings case-insensitively", () => {
    const lower = CHARTER_SECTIONS.map((s) => `## ${s.toLowerCase()}\n\nbody`).join("\n\n");
    expect(validateCharter(lower).ok).toBe(true);
  });

  it("treats an empty document as all sections missing", () => {
    const result = validateCharter("");
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...CHARTER_SECTIONS]);
  });

  it("ships a skeleton that itself validates", () => {
    expect(validateCharter(CHARTER_SKELETON).ok).toBe(true);
  });
});
