import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { RecoveryResult } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { useAuthStore } from "../stores/auth.js";
import { useSettingsStore } from "../stores/settings.js";
import { AjustesPageHeader } from "../components/ajustes/AjustesPageHeader.js";
import { ConfirmReconnectModal } from "../components/ConfirmReconnectModal.js";

type StatusMessage = { tone: "success" | "warning"; text: string };

const summarizeResults = (results: RecoveryResult[], t: TFunction): StatusMessage => {
  const hostStale = results.some((r) => r.kind === "host-stale");
  if (hostStale) {
    return { tone: "warning", text: t("auth.reconnect.result.hostStale") };
  }
  const failures = results.filter((r) => r.kind === "failed");
  if (failures.length > 0) {
    const success = results.length - failures.length;
    return {
      tone: "warning",
      text: t("auth.reconnect.result.partialFailure", {
        success,
        failures: failures.length,
        count: failures.length,
      }),
    };
  }
  const recovered = results.filter((r) => r.kind === "recovered").length;
  return {
    tone: "success",
    text: t("auth.reconnect.result.allRecovered", { count: recovered }),
  };
};

// M16 PR-B2 — sub-página /settings/conta.
// Extrai Auth + AuthMode + ApiKey (linhas 140-263 do antigo Settings.tsx).
// Chaves i18n internas (`settings.auth.*`, `settings.authMode.*`, `settings.apiKey.*`)
// preservadas — apenas a navegação top-level usa `ajustes.*`.

export const AjustesConta: FC = () => {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);
  const setToken = useAuthStore((s) => s.setToken);
  const clearToken = useAuthStore((s) => s.clearToken);
  const apiKeyStatus = useAuthStore((s) => s.apiKeyStatus);
  const setApiKey = useAuthStore((s) => s.setApiKey);
  const clearApiKey = useAuthStore((s) => s.clearApiKey);
  const settings = useSettingsStore((s) => s.settings);
  const setAuthMode = useSettingsStore((s) => s.setAuthMode);
  const agents = useAgentsStore((s) => s.agents);
  const reconnect = useAuthStore((s) => s.reconnectRunningAgents);

  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reconnectPending, setReconnectPending] = useState(false);
  const [reconnectStatus, setReconnectStatus] = useState<StatusMessage | null>(null);

  const runningCount = agents.filter(
    (a) => a.status !== "terminated" && a.status !== "idle",
  ).length;

  const doReconnect = async (): Promise<void> => {
    setConfirming(false);
    setReconnectPending(true);
    setReconnectStatus(null);
    try {
      const results = await reconnect();
      setReconnectStatus(summarizeResults(results, t));
    } finally {
      setReconnectPending(false);
    }
  };

  const onClickReconnect = (): void => {
    if (runningCount === 0) {
      void doReconnect();
    } else {
      setConfirming(true);
    }
  };

  const onSave = async (): Promise<void> => {
    setError(null);
    try {
      await setToken(tokenInput, "manual");
      setTokenInput("");
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  const onClear = async (): Promise<void> => {
    await clearToken();
  };

  const saveApiKey = async (): Promise<void> => {
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

  return (
    <div className="p-8 max-w-2xl">
      <AjustesPageHeader title={t("ajustes.conta.title")} />
      <h1 className="text-2xl font-bold text-ink mb-6">{t("ajustes.conta.title")}</h1>

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
            <div className="pt-3 border-t border-surface-border flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={onClickReconnect}
                disabled={reconnectPending}
                className="px-4 py-2 text-sm font-medium border border-surface-border rounded hover:bg-surface-soft disabled:opacity-50"
              >
                {reconnectPending ? t("auth.reconnect.pending") : t("auth.reconnect.confirm.cta")}
              </button>
              {reconnectStatus !== null && (
                <p
                  className={`text-xs ${
                    reconnectStatus.tone === "success"
                      ? "text-semantic-success"
                      : "text-semantic-warning"
                  }`}
                >
                  {reconnectStatus.text}
                </p>
              )}
            </div>
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
            {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
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

      {confirming && (
        <ConfirmReconnectModal
          agentCount={runningCount}
          onConfirm={() => void doReconnect()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
};
