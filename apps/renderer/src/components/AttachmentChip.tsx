import type { FC } from "react";
import type { Attachment } from "@prospero/shared";

const iconFor = (mime: string): string => {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("text/") || mime === "application/json") return "📝";
  return "📎";
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type Props = {
  attachment: Attachment;
  mode: "pending" | "sent";
  onRemove?: () => void;
  onOpen?: () => void;
};

export const AttachmentChip: FC<Props> = ({ attachment, mode, onRemove, onOpen }) => {
  const clickable = mode === "sent" && onOpen !== undefined;
  return (
    <div
      className={`inline-flex items-center gap-2 bg-surface-card border border-surface-border rounded px-2 py-1.5 text-xs ${clickable ? "cursor-pointer hover:bg-surface-soft" : ""}`}
      onClick={clickable ? onOpen : undefined}
    >
      <span aria-hidden="true">{iconFor(attachment.mimeType)}</span>
      <div className="flex flex-col leading-tight">
        <span className="font-semibold text-ink">{attachment.filename}</span>
        <span className="text-ink-soft text-[10px]">{formatSize(attachment.sizeBytes)}</span>
      </div>
      {mode === "pending" && onRemove !== undefined && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-ink-soft hover:text-ink ml-1"
          aria-label="remove"
        >
          ×
        </button>
      )}
    </div>
  );
};
