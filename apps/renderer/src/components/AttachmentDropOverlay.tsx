import { useEffect, useState, type FC, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  onDrop: (files: File[]) => void;
  children: ReactNode;
};

export const AttachmentDropOverlay: FC<Props> = ({ onDrop, children }) => {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;

    const enter = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files") !== true) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files") !== true) return;
      depth--;
      if (depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const dragover = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files") === true) {
        e.preventDefault();
      }
    };
    const drop = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files") !== true) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onDrop(files);
    };

    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragover);
    window.addEventListener("drop", drop);
    return (): void => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragover);
      window.removeEventListener("drop", drop);
    };
  }, [onDrop]);

  return (
    <div className="relative flex-1 flex flex-col">
      {children}
      {dragging && (
        <div className="absolute inset-2 z-50 border-2 border-dashed border-ink rounded-lg bg-surface/80 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-4xl mb-2">📎</div>
            <div className="text-sm font-semibold text-ink">{t("agent.attachment.dropHere")}</div>
            <div className="text-xs text-ink-soft mt-1">{t("agent.attachment.dropHint")}</div>
          </div>
        </div>
      )}
    </div>
  );
};
