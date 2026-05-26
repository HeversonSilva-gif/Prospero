import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Attachment, ContentBlock, ValidationResult } from "@prospero/shared";

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

export type PersistAttachmentInput = {
  db: Database.Database;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  messageId: string | null;
  userDataDir: string;
};

const attachmentsRoot = (userDataDir: string): string => join(userDataDir, "attachments");

const pendingPath = (root: string, id: string, filename: string): string =>
  join(root, "pending", id, filename);

const messagePath = (root: string, messageId: string, id: string, filename: string): string =>
  join(root, messageId, id, filename);

// eslint-disable-next-line @typescript-eslint/require-await -- async signature reserved for future hashing/scanning work
export const persistAttachment = async (input: PersistAttachmentInput): Promise<Attachment> => {
  const id = randomUUID();
  const root = attachmentsRoot(input.userDataDir);
  const localPath =
    input.messageId === null
      ? pendingPath(root, id, input.filename)
      : messagePath(root, input.messageId, id, input.filename);

  mkdirSync(dirname(localPath), { recursive: true });
  writeFileSync(localPath, input.buffer);

  const now = Date.now();
  input.db
    .prepare(
      `INSERT INTO message_attachments
        (id, message_id, filename, mime_type, size_bytes, local_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.messageId, input.filename, input.mimeType, input.buffer.length, localPath, now);

  return {
    id,
    messageId: input.messageId,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    createdAt: now,
  };
};

export const loadAttachment = (id: string, db: Database.Database): Buffer | null => {
  const row = db.prepare("SELECT local_path FROM message_attachments WHERE id = ?").get(id) as
    | { local_path: string }
    | undefined;
  if (row === undefined) return null;
  if (!existsSync(row.local_path)) return null;
  return readFileSync(row.local_path);
};

export const deleteAttachment = (id: string, db: Database.Database): void => {
  const row = db.prepare("SELECT local_path FROM message_attachments WHERE id = ?").get(id) as
    | { local_path: string }
    | undefined;
  if (row !== undefined) {
    try {
      rmSync(row.local_path, { force: true });
    } catch {
      // best-effort; row removal proceeds
    }
    db.prepare("DELETE FROM message_attachments WHERE id = ?").run(id);
  }
};
