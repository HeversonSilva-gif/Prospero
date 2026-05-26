import type { ContentBlock, ValidationResult } from "@prospero/shared";

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

export type LoadedAttachment = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

export const buildContentBlocks = (
  text: string,
  attachments: LoadedAttachment[],
): ContentBlock[] => {
  const blocks: ContentBlock[] = [];

  // Text attachments are inlined into the text block (with a separator).
  const textAttachments = attachments.filter(
    (a) => a.mimeType.startsWith("text/") || a.mimeType === "application/json",
  );
  const binaryAttachments = attachments.filter(
    (a) => !a.mimeType.startsWith("text/") && a.mimeType !== "application/json",
  );

  let textBlockContent = text;
  for (const t of textAttachments) {
    textBlockContent += `\n\n--- ${t.filename} ---\n${t.buffer.toString("utf8")}`;
  }

  if (textBlockContent !== "" || textAttachments.length > 0 || binaryAttachments.length === 0) {
    blocks.push({ type: "text", text: textBlockContent });
  }

  for (const a of binaryAttachments) {
    if (a.mimeType.startsWith("image/")) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: a.mimeType, data: a.buffer.toString("base64") },
      });
    } else if (a.mimeType === "application/pdf") {
      blocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: a.buffer.toString("base64"),
        },
      });
    }
    // Other mime types skipped silently — should have been filtered by validate.
  }

  return blocks;
};
