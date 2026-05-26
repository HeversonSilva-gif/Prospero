export type Attachment = {
  id: string;
  messageId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
};

export type ImageContentBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};

export type DocumentContentBlock = {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
};

export type TextContentBlock = { type: "text"; text: string };

export type ContentBlock = TextContentBlock | ImageContentBlock | DocumentContentBlock;

export type ValidationReason =
  | "image-too-big"
  | "file-too-big"
  | "mime-not-allowed"
  | "empty-buffer";

export type ValidationResult = { ok: true } | { ok: false; reason: ValidationReason };
