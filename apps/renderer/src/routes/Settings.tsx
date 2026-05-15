import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/auth.js";
import { ModelDropdown } from "../components/ModelDropdown.js";
import { useSettingsStore } from "../stores/settings.js";
import { BudgetsForm } from "../components/costs/BudgetsForm.js";
import { useCompaniesStore } from "../stores/companies.js";
import { AgentsMdImportSection } from "../components/settings/AgentsMdImportSection.js";

export const Settings = () => {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);
  const setToken = useAuthStore((s) => s.setToken);
  const clearToken = useAuthStore((s) => s.clearToken);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const setModel = useSettingsStore((s) => s.setModel);
  const saveExecutorMode = useSettingsStore((s) => s.saveExecutorMode);
  const setAuthMode = useSettingsStore((s) => s.setAuthMode);
  const apiKeyStatus = useAuthStore((s) => s.apiKeyStatus);
  const setApiKey = useAuthStore((s) => s.setApiKey);
  const clearApiKey = useAuthStore((s) => s.clearApiKey);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
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

  const onSave = async () => {
    setError(null);
    try {
      await setToken(tokenInput, "manual");
      setTokenInput("");
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  const onClear = async () => {
    await clearToken();
  };

  const saveApiKey = async () => {
    setApiKeyBusy(true);
    setApiKeyError(null);
    try {
      await setApiKey(apiKeyInput);
      setApiKeyInput("");
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApiKeyBusy(false);
    }
  };

  const saveModel = async (next: string) => {
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
      const result = await window.dashboardAgent.companies.importSnapshot(parsed);
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

  const onExportCompany = async () => {
    if (activeCompanyId === null) {
      setExportError(t("settings.companyExport.noActiveCompany"));
      return;
    }
    setExportBusy(true);
    setExportError(null);
    setExportSavedAt(null);
    try {
      const snapshot = await window.dashboardAgent.companies.exportSnapshot(activeCompanyId);
      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard-agent-company-${activeCompanyId}.json`;
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
      <h1 className="text-2xl font-bold text-brand-dark mb-6">{t("settings.title")}</h1>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-3">{t("settings.auth.title")}</h2>
        {status.hasToken ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {t("settings.auth.statusActive")}: <code>{status.maskedPrefix}</code>
            </p>
            <p className="text-xs text-ink-muted">
              {status.source === "manual"
                ? t("settings.auth.source.manual")
                : t("settings.auth.source.autoDetect")}
            </p>
            <button
              onClick={() => void onClear()}
              className="text-sm text-semantic-danger hover:underline"
              type="button"
            >
              {t("settings.auth.actionClear")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">{t("settings.auth.statusEmpty")}</p>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="sk-ant-oat-..."
              className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
            />
            {error && <p className="text-xs text-semantic-danger">{error}</p>}
            <button
              onClick={() => void onSave()}
              disabled={tokenInput.length === 0}
              className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
              type="button"
            >
              {t("settings.auth.actionSet")}
            </button>
          </div>
        )}
      </section>

      <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          {t("settings.authMode.title")}
        </h2>
        <p className="text-xs text-ink-muted mb-3">{t("settings.authMode.subtitle")}</p>
        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="authMode"
              value="oauth"
              checked={settings.authMode === "oauth"}
              onChange={() => void setAuthMode("oauth")}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-ink">{t("settings.authMode.oauth")}</div>
              <div className="text-xs text-ink-muted">{t("settings.authMode.oauthDesc")}</div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="authMode"
              value="api-key"
              checked={settings.authMode === "api-key"}
              onChange={() => void setAuthMode("api-key")}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-ink">{t("settings.authMode.apiKey")}</div>
              <div className="text-xs text-ink-muted">{t("settings.authMode.apiKeyDesc")}</div>
            </div>
          </label>
        </div>

        {settings.authMode === "api-key" && (
          <div className="mt-4 pl-6 border-l-2 border-surface-border">
            {apiKeyStatus.hasKey ? (
              <div className="space-y-2">
                <code className="block text-xs bg-surface-soft p-2 rounded text-ink-muted">
                  {apiKeyStatus.maskedPrefix}
                </code>
                <button
                  type="button"
                  onClick={() => void clearApiKey()}
                  className="text-xs text-semantic-danger hover:underline"
                >
                  {t("settings.apiKey.clear")}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={t("settings.apiKey.placeholder")}
                  disabled={apiKeyBusy}
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-soft border border-surface-border rounded"
                />
                {apiKeyError !== null && (
                  <p className="text-xs text-semantic-danger">{apiKeyError}</p>
                )}
                <button
                  type="button"
                  onClick={() => void saveApiKey()}
                  disabled={apiKeyBusy || apiKeyInput.length === 0}
                  className="px-3 py-1 text-xs font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
                >
                  {apiKeyBusy ? t("settings.apiKey.saving") : t("settings.apiKey.save")}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

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
                      void window.dashboardAgent.settings
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
                void window.dashboardAgent.settings
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
            {t("nav.projects")}
          </Link>
          .
        </p>
      </section>
    </div>
  );
};
