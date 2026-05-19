import { describe, it, expect } from "vitest";
import {
  TELOS_SECTIONS,
  TELOS_SKELETON,
  buildTelosSkeleton,
  validateTelos,
  getTelosSection,
} from "./telos.js";

describe("telos module", () => {
  it("has the 5 canonical sections in order", () => {
    expect(TELOS_SECTIONS).toEqual([
      "Mission",
      "Long-term Goals",
      "Principles",
      "Ideal State",
      "Non-goals",
    ]);
  });

  it("TELOS_SKELETON validates by construction", () => {
    expect(validateTelos(TELOS_SKELETON)).toEqual({ ok: true, missing: [] });
  });

  it("buildTelosSkeleton produces the same output as TELOS_SKELETON", () => {
    expect(buildTelosSkeleton()).toBe(TELOS_SKELETON);
  });

  it("validateTelos reports missing sections in canonical order", () => {
    const partial = "## Principles\n\nx\n\n## Mission\n\ny";
    const res = validateTelos(partial);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["Long-term Goals", "Ideal State", "Non-goals"]);
  });

  it("validateTelos tolerates a numeric prefix and is case-insensitive", () => {
    const body = TELOS_SECTIONS.map((s, i) => `## ${i + 1}. ${s.toUpperCase()}`).join("\n\n");
    expect(validateTelos(body).ok).toBe(true);
  });

  it("getTelosSection returns one section's body, or null when absent", () => {
    expect(getTelosSection(TELOS_SKELETON, "Mission")).toBe("_Describe this section._");
    expect(getTelosSection(TELOS_SKELETON, "Nonexistent")).toBeNull();
  });

  it("getTelosSection reads sections from a CRLF document", () => {
    const crlf = TELOS_SKELETON.replace(/\n/g, "\r\n");
    expect(getTelosSection(crlf, "Principles")).toBe("_Describe this section._");
  });

  it("getTelosSection reads the last section (no trailing heading)", () => {
    expect(getTelosSection(TELOS_SKELETON, "Non-goals")).toBe("_Describe this section._");
  });
});
