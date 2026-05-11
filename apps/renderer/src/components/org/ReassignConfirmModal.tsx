import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  childName: string;
  newParentName: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

export const ReassignConfirmModal: FC<Props> = ({
  childName,
  newParentName,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center">
      <div className="bg-surface-card rounded-lg shadow-xl w-[400px] p-5">
        <h2 className="text-sm font-bold text-brand-dark mb-3">{t("org.reassign.title")}</h2>
        <p className="text-xs text-ink-muted mb-5">
          {t("org.reassign.message", { child: childName, parent: newParentName })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
            disabled={busy}
            className="text-xs px-3 py-1 bg-brand text-white rounded disabled:opacity-50"
          >
            {busy ? "…" : t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
