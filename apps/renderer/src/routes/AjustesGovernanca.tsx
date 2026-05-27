import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { GovernanceConfig, PolicyConfig } from "@prospero/shared";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";
import { QuietHoursEditor } from "../components/QuietHoursEditor.js";

export const AjustesGovernanca: FC = () => {
  const { t } = useTranslation();
  const companyId = useActiveCompanyId();
  const [cfg, setCfg] = useState<GovernanceConfig | null>(null);
  const [isQuietNow, setIsQuietNow] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (companyId === null) return;
    void window.prospero.governance.get(companyId).then(setCfg);
    void window.prospero.governance.isQuietNow(companyId).then(setIsQuietNow);
  }, [companyId]);

  const setPolicy = <K extends keyof PolicyConfig>(key: K, value: PolicyConfig[K]): void => {
    if (cfg === null) return;
    setCfg({ ...cfg, policies: { ...cfg.policies, [key]: value } });
  };

  const handleSave = async (): Promise<void> => {
    if (cfg === null || companyId === null) return;
    setSaving(true);
    try {
      const normalized = await window.prospero.governance.update(companyId, cfg);
      setCfg(normalized);
      setSavedAt(Date.now());
      setIsQuietNow(await window.prospero.governance.isQuietNow(companyId));
    } finally {
      setSaving(false);
    }
  };

  if (cfg === null) {
    return <p className="text-ink-muted p-8">{t("common.loading")}</p>;
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">{t("settings.governance.title")}</h1>
        <p className="text-sm text-ink-muted mt-1">{t("settings.governance.subtitle")}</p>
      </header>

      {isQuietNow && (
        <div className="bg-surface-soft border border-surface-border rounded p-3 text-sm text-ink">
          {t("settings.governance.quietActiveBanner")}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
          {t("settings.governance.quietHoursTitle")}
        </h2>
        <p className="text-xs text-ink-muted">{t("settings.governance.quietHoursHelp")}</p>
        <QuietHoursEditor
          value={cfg.quietHours}
          onChange={(next) => setCfg({ ...cfg, quietHours: next })}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
          {t("settings.governance.policiesTitle")}
        </h2>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={cfg.policies.autoApproveReadOnlyAcrossProjects}
            onChange={(e) => setPolicy("autoApproveReadOnlyAcrossProjects", e.target.checked)}
            className="mt-1"
          />
          <span>
            <strong>{t("settings.governance.readOnlyTitle")}</strong>
            <br />
            <span className="text-ink-muted text-xs">{t("settings.governance.readOnlyHelp")}</span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="number"
            step="0.10"
            min="0"
            value={cfg.policies.autoApproveSpendUnderUsdPerDay ?? ""}
            onChange={(e) =>
              setPolicy(
                "autoApproveSpendUnderUsdPerDay",
                e.target.value === "" ? null : Number.parseFloat(e.target.value),
              )
            }
            placeholder={t("settings.governance.spendCapPlaceholder")}
            className="mt-1 w-24 bg-surface-soft border border-surface-border rounded px-2 py-1"
          />
          <span>
            <strong>{t("settings.governance.spendCapTitle")}</strong>
            <br />
            <span className="text-ink-muted text-xs">{t("settings.governance.spendCapHelp")}</span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={cfg.policies.ceoCanDecideFires}
            onChange={(e) => setPolicy("ceoCanDecideFires", e.target.checked)}
            className="mt-1"
          />
          <span>
            <strong>{t("settings.governance.ceoFiresTitle")}</strong>
            <br />
            <span className="text-ink-muted text-xs">{t("settings.governance.ceoFiresHelp")}</span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={cfg.policies.ceoCanDecideBudgetOverruns}
            onChange={(e) => setPolicy("ceoCanDecideBudgetOverruns", e.target.checked)}
            className="mt-1"
          />
          <span>
            <strong>{t("settings.governance.ceoBudgetTitle")}</strong>
            <br />
            <span className="text-ink-muted text-xs">{t("settings.governance.ceoBudgetHelp")}</span>
          </span>
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
          {t("settings.governance.timeoutTitle")}
        </h2>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="range"
            min="1"
            max="12"
            step="1"
            value={cfg.policies.bouncedToCeoTtlHours}
            onChange={(e) => setPolicy("bouncedToCeoTtlHours", Number.parseInt(e.target.value, 10))}
          />
          <span>
            {cfg.policies.bouncedToCeoTtlHours}h —{" "}
            <span className="text-ink-muted text-xs">{t("settings.governance.timeoutHelp")}</span>
          </span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="bg-brand text-white text-sm font-semibold px-4 py-2 rounded disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
        {savedAt !== null && (
          <span className="text-xs text-semantic-success">{t("common.saved")}</span>
        )}
      </div>
    </div>
  );
};
