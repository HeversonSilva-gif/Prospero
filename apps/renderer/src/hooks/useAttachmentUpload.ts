import { useState, useCallback } from "react";
import type { Attachment } from "@prospero/shared";

const MAX = 10;

export type UseAttachmentUpload = {
  attachments: Attachment[];
  uploading: boolean;
  error: string | null;
  addFiles: (files: File[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => void;
};

export const useAttachmentUpload = (): UseAttachmentUpload => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(
    async (files: File[]): Promise<void> => {
      setError(null);
      setUploading(true);
      try {
        let current = attachments.length;
        for (const file of files) {
          if (current >= MAX) {
            setError("max-attachments");
            break;
          }
          const buf = await file.arrayBuffer();
          try {
            const att = await window.prospero.attachments.upload({
              buffer: buf,
              filename: file.name,
              mimeType: file.type === "" ? "application/octet-stream" : file.type,
            });
            setAttachments((prev) => [...prev, att]);
            current += 1;
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }
      } finally {
        setUploading(false);
      }
    },
    [attachments.length],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    await window.prospero.attachments.delete(id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback((): void => {
    setAttachments([]);
  }, []);

  return { attachments, uploading, error, addFiles, remove, clear };
};
