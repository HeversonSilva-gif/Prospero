import type { ValidationResult } from "@prospero/shared";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_OTHER_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const ALLOWED_OTHER_MIMES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
]);

export const isImageMime = (mime: string): boolean => ALLOWED_IMAGE_MIMES.has(mime);
export const isAllowedMime = (mime: string): boolean =>
  ALLOWED_IMAGE_MIMES.has(mime) || ALLOWED_OTHER_MIMES.has(mime) || mime.startsWith("text/");

export const validateAttachment = (buffer: Buffer, mimeType: string): ValidationResult => {
  if (buffer.length === 0) return { ok: false, reason: "empty-buffer" };
  if (!isAllowedMime(mimeType)) return { ok: false, reason: "mime-not-allowed" };
  if (isImageMime(mimeType) && buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "image-too-big" };
  }
  if (!isImageMime(mimeType) && buffer.length > MAX_OTHER_BYTES) {
    return { ok: false, reason: "file-too-big" };
  }
  return { ok: true };
};
