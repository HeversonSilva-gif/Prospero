import { describe, it, expect } from "vitest";
import { validateAttachment, MAX_IMAGE_BYTES, MAX_OTHER_BYTES } from "./attachments.js";

describe("validateAttachment", () => {
  it("accepts a small PNG", () => {
    const buf = Buffer.alloc(100);
    expect(validateAttachment(buf, "image/png")).toEqual({ ok: true });
  });

  it("rejects image larger than 5 MB", () => {
    const buf = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    expect(validateAttachment(buf, "image/jpeg")).toEqual({
      ok: false,
      reason: "image-too-big",
    });
  });

  it("accepts PDF up to 20 MB", () => {
    const buf = Buffer.alloc(MAX_OTHER_BYTES);
    expect(validateAttachment(buf, "application/pdf")).toEqual({ ok: true });
  });

  it("rejects PDF over 20 MB", () => {
    const buf = Buffer.alloc(MAX_OTHER_BYTES + 1);
    expect(validateAttachment(buf, "application/pdf")).toEqual({
      ok: false,
      reason: "file-too-big",
    });
  });

  it("rejects empty buffer", () => {
    expect(validateAttachment(Buffer.alloc(0), "image/png")).toEqual({
      ok: false,
      reason: "empty-buffer",
    });
  });

  it("rejects unknown mime types", () => {
    const buf = Buffer.alloc(100);
    expect(validateAttachment(buf, "application/zip")).toEqual({
      ok: false,
      reason: "mime-not-allowed",
    });
  });

  it("accepts text/plain, text/markdown, application/json", () => {
    const buf = Buffer.alloc(100);
    expect(validateAttachment(buf, "text/plain").ok).toBe(true);
    expect(validateAttachment(buf, "text/markdown").ok).toBe(true);
    expect(validateAttachment(buf, "application/json").ok).toBe(true);
  });
});
