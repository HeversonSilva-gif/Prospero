import { useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useUpdaterStore } from "../stores/updater.js";

// M17 — global bottom-right banner shown once an update has finished
// downloading. Snooze hides it until the next downloaded event. Mounted in the
// Shell, so its useEffect is the single subscription point for updater events.
export const UpdateBanner: FC = () => {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const snoozed = useUpdaterStore((s) => s.snoozed);
  const installNow = useUpdaterStore((s) => s.installNow);
  const snooze = useUpdaterStore((s) => s.snooze);
  const init = useUpdaterStore((s) => s.init);

  useEffect(() => init(), [init]);

  if (status.state !== "downloaded" || snoozed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-surface-card border border-surface-border rounded-lg shadow-xl p-3 flex items-center gap-3">
      <span className="text-sm text-ink">
        {t("updater.downloaded", { version: status.version ?? "" })}
      </span>
      <button
        type="button"
        onClick={() => void installNow()}
        className="text-xs px-3 py-1.5 bg-semantic-success text-white rounded font-semibold whitespace-nowrap"
      >
        {t("updater.restartNow")}
      </button>
      <button
        type="button"
        onClick={snooze}
        className="text-xs px-2 py-1.5 text-ink-muted hover:text-ink whitespace-nowrap"
      >
        {t("updater.later")}
      </button>
    </div>
  );
};
