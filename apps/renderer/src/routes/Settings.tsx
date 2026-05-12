import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/auth.js";
import { ModelDropdown } from "../components/ModelDropdown.js";
import { useSettingsStore } from "../stores/settings.js";

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
  const [modelSaved, setModelSaved] = useState(false);

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

  const saveModel = async (next: string) => {
    await setModel(next);
    setModelSaved(true);
    window.setTimeout(() => setModelSaved(false), 2000);
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
