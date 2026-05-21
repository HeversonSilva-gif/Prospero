import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { useUpdaterStore } from "../../stores/updater.js";

// M17 — "Atualizações" section in Ajustes › Avançado. Reads the shared updater
// store (the subscription lives in UpdateBanner) and offers a manual check +
// restart-to-install. Auto-download stays on; current-version display is
// deferred (needs an app.getVersion IPC).
export const UpdatesSection: FC = () => {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const checkNow = useUpdaterStore((s) => s.checkNow);
  const installNow = useUpdaterStore((s) => s.installNow);

  const busy = status.state === "checking" || status.state === "downloading";

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">{t("updater.title")}</h2>
      <p className="text-xs text-ink-muted mb-3">{t("updater.subtitle")}</p>

      <p className="text-sm text-ink">
        {t("updater.statusLabel")}:{" "}
        <span className="font-medium">{t(`updater.state.${status.state}`)}</span>
        {status.state === "downloading" && status.percent !== null ? ` (${status.percent}%)` : ""}
        {status.version !== null ? ` · v${status.version}` : ""}
      </p>
      {status.state === "error" && status.error !== null && (
        <p className="mt-1 text-xs text-semantic-danger">{status.error}</p>
      )}

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => void checkNow()}
          disabled={busy}
          className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
        >
          {t("updater.checkNow")}
        </button>
        {status.state === "downloaded" && (
          <button
            type="button"
            onClick={() => void installNow()}
            className="px-3 py-1.5 text-sm font-semibold bg-semantic-success text-white rounded"
          >
            {t("updater.restartNow")}
          </button>
        )}
      </div>
    </section>
  );
};
