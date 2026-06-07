import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settings.js";
import { useCompaniesStore } from "../../stores/companies.js";

// Global play/pause for the autonomous loop. The app opens PAUSED (the main
// process forces it at boot) so just opening never spends — this bar is the call
// to action to activate, and the always-visible status when active so the user
// always knows whether the team is spending. Manual actions (genesis, chatting)
// are not gated by this; only the autonomous reconciler is.
export const AutonomyBanner: FC = () => {
  const { t } = useTranslation();
  const loaded = useSettingsStore((s) => s.loaded);
  const paused = useSettingsStore((s) => s.settings.autonomyPaused);
  const setAutonomyPaused = useSettingsStore((s) => s.setAutonomyPaused);
  // Only relevant once there's a team to run — hide on the setup/genesis screen.
  const hasCompany = useCompaniesStore((s) => s.companies.length > 0);

  if (!loaded || !hasCompany) return null;

  if (paused) {
    return (
      <div className="bg-semantic-warning text-ink px-4 py-2 text-sm flex items-center justify-between gap-3">
        <span>{t("banners.autonomy.pausedMessage")}</span>
        <button
          onClick={() => void setAutonomyPaused(false)}
          className="shrink-0 px-3 py-1 rounded bg-brand text-brand-fg text-xs font-semibold"
          type="button"
        >
          {t("banners.autonomy.activate")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface-soft text-ink-soft px-4 py-1 text-xs flex items-center justify-between gap-3 border-b border-surface-border">
      <span>{t("banners.autonomy.activeMessage")}</span>
      <button
        onClick={() => void setAutonomyPaused(true)}
        className="shrink-0 px-2 py-0.5 rounded border border-surface-border text-xs hover:bg-surface-card"
        type="button"
      >
        {t("banners.autonomy.pause")}
      </button>
    </div>
  );
};
