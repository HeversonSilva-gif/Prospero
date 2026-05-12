import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";

type Props = { onSubmit: (content: string) => Promise<void> };

export const CommentComposer: FC<Props> = ({ onSubmit }) => {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (text.trim() === "") return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-2 mt-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={t("issues.detail.commentPlaceholder")}
        className="flex-1 px-2 py-1 border border-surface-border rounded text-xs"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="text-xs px-3 py-1 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50 self-start"
      >
        {t("issues.detail.send")}
      </button>
    </div>
  );
};
