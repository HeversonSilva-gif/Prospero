import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  title?: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export const ConfirmModal: FC<Props> = ({
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-surface-card rounded p-5 w-full max-w-sm shadow-xl">
        {title !== undefined && title !== "" && (
          <h3 className="text-sm font-semibold text-brand-dark mb-2">{title}</h3>
        )}
        <p className="text-sm text-ink-muted mb-4">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            className={`text-xs px-3 py-1 rounded font-semibold disabled:opacity-50 ${destructive ? "bg-semantic-danger text-white" : "bg-brand text-brand-fg"}`}
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
