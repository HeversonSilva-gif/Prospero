import type { FC } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  agentCount: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmReconnectModal: FC<Props> = ({ agentCount, onConfirm, onCancel }) => {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-2 text-ink">{t("auth.reconnect.confirm.title")}</h2>
        <p className="text-sm text-ink mb-4">
          {t("auth.reconnect.confirm.body", { count: agentCount })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-soft rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-semibold bg-brand text-brand-fg rounded"
          >
            {t("auth.reconnect.confirm.cta")}
          </button>
        </div>
      </div>
    </div>
  );
};
