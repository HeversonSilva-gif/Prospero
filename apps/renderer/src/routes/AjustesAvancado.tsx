import { useState, useEffect, useRef, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ModelDropdown } from "../components/ModelDropdown.js";
import { useSettingsStore } from "../stores/settings.js";
import { BudgetsForm } from "../components/costs/BudgetsForm.js";
import { useCompaniesStore } from "../stores/companies.js";
import { AgentsMdImportSection } from "../components/settings/AgentsMdImportSection.js";
import { MemorySettingsSection } from "../components/settings/MemorySettingsSection.js";
import { RemoteExecutionSection } from "../components/settings/RemoteExecutionSection.js";
import { SecurityZonesPanel } from "../components/settings/SecurityZonesPanel.js";
import { AjustesPageHeader } from "../components/ajustes/AjustesPageHeader.js";

// M16 PR-B2 — sub-página /settings/avancado.
// Power-user content extraído do antigo Settings.tsx:
// Model · Budgets · Executor · Remote · Memory · SecurityZones · AgentDefaults ·
// CompanyExport · AgentsMdImport · CompanyImport · Workspace deprecated.

export const AjustesAvancado: FC = () => {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const setModel = useSettingsStore((s) => s.setModel);
  const saveExecutorMode = useSettingsStore((s) => s.saveExecutorMode);
  const [modelSaved, setModelSaved] = useState(false);

  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const reloadCompanies = useCompaniesStore((s) => s.load);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSavedAt, setExportSavedAt] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{
    name: string;
    counts: Record<string, number>;
    warnings: string[];
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveModel = async (next: string): Promise<void> => {
    await setModel(next);
    setModelSaved(true);
    window.setTimeout(() => setModelSaved(false), 2000);
  };

  const onImportFile = async (file: File): Promise<void> => {
    setImportBusy(true);
    setImportError(null);
    setImportSummary(null);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const result = await window.prospero.companies.importSnapshot(parsed);
      setImportSummary({
        name: result.newCompanyName,
        counts: result.counts,
        warnings: result.warnings,
      });
      await reloadCompanies();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
      if (importInputRef.current !== null) {
        importInputRef.current.value = "";
      }
    }
  };

  const onExportCompany = async (): Promise<void> => {
    if (activeCompanyId === null) {
      setExportError(t("settings.companyExport.noActiveCompany"));
      return;
    }
    setExportBusy(true);
    setExportError(null);
    setExportSavedAt(null);
    try {
      const snapshot = await window.prospero.companies.exportSnapshot(activeCompanyId);
      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prospero-company-${activeCompanyId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportSavedAt(a.download);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <AjustesPageHeader title={t("ajustes.avancado.title")} />
      <h1 className="text-2xl font-bold text-ink mb-6">{t("ajustes.avancado.title")}</h1>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          {t("settings.model.title")}
        </h2>
        <p className="text-xs text-ink-muted mb-3">{t("settings.model.hint")}</p>
        <ModelDropdown
          value={settings.defaultModelForNewAgents}
          onChange={(v) => void saveModel(v)}
        />
        {modelSaved && (
          <p className="text-xs text-semantic-success mt-2">{t("settings.model.saved")}</p>
        )}
      </section>

      <BudgetsForm />

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          {t("settings.executor.title")}
        </h2>
        <p className="text-xs text-ink-muted mb-3">{t("settings.executor.subtitle")}</p>
        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="executorMode"
              value="atomic"
              checked={settings.executorMode === "atomic"}
              onChange={() => void saveExecutorMode("atomic")}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-ink">{t("settings.executor.atomic")}</div>
              <div className="text-xs text-ink-muted">{t("settings.executor.atomicDesc")}</div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="executorMode"
              value="narrated"
              checked={settings.executorMode === "narrated"}
              onChange={() => void saveExecutorMode("narrated")}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-ink">{t("settings.executor.narrated")}</div>
              <div className="text-xs text-ink-muted">{t("settings.executor.narratedDesc")}</div>
            </div>
          </label>
        </div>
      </section>

      <RemoteExecutionSection />
      <MemorySettingsSection />
      <SecurityZonesPanel />

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          {t("settings.agentDefaults.title")}
        </h2>
        <p className="text-xs text-ink-muted mb-3">{t("settings.agentDefaults.subtitle")}</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              {t("settings.agentDefaults.modeLabel")}
            </label>
            <div className="flex gap-3 text-sm">
              {(["supervised", "auto"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="defaultAgentMode"
                    checked={settings.defaultAgentMode === m}
                    onChange={() =>
                      void window.prospero.settings
                        .update({ defaultAgentMode: m })
                        .then(() => loadSettings())
                    }
                  />
                  {t(`agent.config.mode.${m}`)}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.defaultAlwaysOn}
              onChange={(e) =>
                void window.prospero.settings
                  .update({ defaultAlwaysOn: e.target.checked })
                  .then(() => loadSettings())
              }
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-ink">
                {t("settings.agentDefaults.alwaysOnLabel")}
              </div>
              <div className="text-xs text-ink-muted">
                {t("settings.agentDefaults.alwaysOnDesc")}
              </div>
            </div>
          </label>
        </div>
      </section>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          {t("settings.companyExport.title")}
        </h2>
        <p className="text-xs text-ink-muted mb-3">{t("settings.companyExport.subtitle")}</p>
        <button
          type="button"
          onClick={() => void onExportCompany()}
          disabled={exportBusy}
          className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
        >
          {exportBusy ? t("settings.companyExport.exporting") : t("settings.companyExport.action")}
        </button>
        {exportError !== null && <p className="mt-2 text-xs text-semantic-danger">{exportError}</p>}
        {exportSavedAt !== null && (
          <p className="mt-2 text-xs text-semantic-success">
            {t("settings.companyExport.savedAt", { path: exportSavedAt })}
          </p>
        )}
      </section>

      <AgentsMdImportSection />

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          {t("settings.companyImport.title")}
        </h2>
        <p className="text-xs text-ink-muted mb-3">{t("settings.companyImport.subtitle")}</p>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void onImportFile(file);
          }}
        />
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          disabled={importBusy}
          className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
        >
          {importBusy ? t("settings.companyImport.importing") : t("settings.companyImport.action")}
        </button>
        {importError !== null && <p className="mt-2 text-xs text-semantic-danger">{importError}</p>}
        {importSummary !== null && (
          <div className="mt-3 text-xs space-y-1">
            <p className="text-semantic-success">
              {t("settings.companyImport.success", { name: importSummary.name })}
            </p>
            <ul className="text-ink-muted pl-3 list-disc">
              {Object.entries(importSummary.counts)
                .filter(([, n]) => n > 0)
                .map(([entity, n]) => (
                  <li key={entity}>
                    {entity}: {n}
                  </li>
                ))}
            </ul>
            {importSummary.warnings.length > 0 && (
              <details className="text-ink-muted">
                <summary className="cursor-pointer">
                  {t("settings.companyImport.warningsCount", {
                    count: importSummary.warnings.length,
                  })}
                </summary>
                <ul className="pl-3 list-disc mt-1">
                  {importSummary.warnings.slice(0, 20).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-brand-dark mb-2">
          {t("settings.workspace.label")}
        </h2>
        <p className="text-xs text-ink-muted">
          {t("settings.workspace.deprecatedNote")}{" "}
          <Link to="/projects" className="text-brand hover:underline">
            {t("nav.projetos")}
          </Link>
          .
        </p>
      </section>
    </div>
  );
};
