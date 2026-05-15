import { describe, expect, it } from "vitest";
import { requiresComment, statusForDecision, validateDecision } from "./decision.js";

describe("statusForDecision", () => {
  it("maps approve → done", () => {
    expect(statusForDecision("approve")).toBe("done");
  });
  it("maps request_changes → doing", () => {
    expect(statusForDecision("request_changes")).toBe("doing");
  });
  it("maps reject → cancelled", () => {
    expect(statusForDecision("reject")).toBe("cancelled");
  });
});

describe("requiresComment", () => {
  it("only approve is optional", () => {
    expect(requiresComment("approve")).toBe(false);
    expect(requiresComment("request_changes")).toBe(true);
    expect(requiresComment("reject")).toBe(true);
  });
});

describe("validateDecision", () => {
  it("approve passes regardless of comment", () => {
    expect(validateDecision("approve", "")).toEqual({ ok: true });
    expect(validateDecision("approve", "ship it")).toEqual({ ok: true });
  });
  it("request_changes requires non-blank comment", () => {
    expect(validateDecision("request_changes", "")).toEqual({
      ok: false,
      reason: "comment_required",
    });
    expect(validateDecision("request_changes", "   \n  ")).toEqual({
      ok: false,
      reason: "comment_required",
    });
    expect(validateDecision("request_changes", "please rename foo")).toEqual({ ok: true });
  });
  it("reject requires non-blank comment", () => {
    expect(validateDecision("reject", "")).toEqual({ ok: false, reason: "comment_required" });
    expect(validateDecision("reject", "duplicates issue 42")).toEqual({ ok: true });
  });
});
