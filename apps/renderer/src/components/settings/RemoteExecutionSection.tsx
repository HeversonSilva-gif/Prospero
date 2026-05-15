import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settings.js";

export const RemoteExecutionSection: FC = () => {
  const { t } = useTranslation();
  const remote = useSettingsStore((s) => s.settings.remoteExecution);
  const setRemoteExecution = useSettingsStore((s) => s.setRemoteExecution);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const onTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.prospero.remote.testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("settings.remoteExecution.title")}
      </h2>
      <p className="text-xs text-ink-muted mb-3">{t("settings.remoteExecution.subtitle")}</p>

      <label className="flex items-start gap-3 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={remote.enabled}
          onChange={(e) => void setRemoteExecution({ enabled: e.target.checked })}
          className="mt-1"
        />
        <span className="text-sm font-medium text-ink">{t("settings.remoteExecution.enable")}</span>
      </label>

      {remote.enabled && (
        <div className="space-y-3 pl-6 border-l-2 border-surface-border">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              {t("settings.remoteExecution.modeLabel")}
            </label>
            <div className="flex gap-3 text-sm">
              {(["local-docker", "remote-vps"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="remoteExecutionMode"
                    checked={remote.mode === m}
                    onChange={() => void setRemoteExecution({ mode: m })}
                  />
                  {m === "local-docker"
                    ? t("settings.remoteExecution.modeLocal")
                    : t("settings.remoteExecution.modeRemote")}
                </label>
              ))}
            </div>
          </div>

          {remote.mode === "remote-vps" && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  {t("settings.remoteExecution.vpsHost")}
                </label>
                <input
                  type="text"
                  value={remote.vpsHost}
                  onChange={(e) => void setRemoteExecution({ vpsHost: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  {t("settings.remoteExecution.vpsUser")}
                </label>
                <input
                  type="text"
                  value={remote.vpsUser}
                  onChange={(e) => void setRemoteExecution({ vpsUser: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  {t("settings.remoteExecution.vpsKeyPath")}
                </label>
                <input
                  type="text"
                  value={remote.vpsKeyPath}
                  onChange={(e) => void setRemoteExecution({ vpsKeyPath: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
                />
              </div>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => void onTest()}
              disabled={testing}
              className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
            >
              {testing ? t("settings.remoteExecution.testing") : t("settings.remoteExecution.test")}
            </button>
            {testResult !== null && (
              <p
                className={`mt-2 text-xs ${
                  testResult.ok ? "text-semantic-success" : "text-semantic-danger"
                }`}
              >
                {testResult.ok
                  ? t("settings.remoteExecution.testOk", { message: testResult.message })
                  : t("settings.remoteExecution.testFail", { message: testResult.message })}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
