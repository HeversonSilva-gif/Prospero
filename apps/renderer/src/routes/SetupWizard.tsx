import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth.js";

type Step = "choose" | "manual" | "auto";

export const SetupWizard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const importDetected = useAuthStore((s) => s.importDetected);
  const [step, setStep] = useState<Step>("choose");
  const [tokenInput, setTokenInput] = useState("");
  // We only ever hold the masked prefix in renderer state — never the raw token.
  // The actual import is done main-side via importDetected (re-runs detection + saves).
  const [autoPrefix, setAutoPrefix] = useState<string | null>(null);
  const [autoSearched, setAutoSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goAuto = async () => {
    setStep("auto");
    setError(null);
    const result = await window.dashboardAgent.auth.detect();
    setAutoPrefix(result.found ? result.maskedPrefix : null);
    setAutoSearched(true);
  };

  const importAuto = async () => {
    if (autoPrefix === null) return;
    try {
      await importDetected();
      navigate("/dashboard");
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  const saveManual = async () => {
    setError(null);
    try {
      await setToken(tokenInput, "manual");
      navigate("/dashboard");
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-surface-soft">
      <div className="max-w-xl w-full bg-surface-card border border-surface-border rounded-xl p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-brand-dark mb-2">{t("wizard.title")}</h1>
        <p className="text-sm text-ink-muted mb-6">{t("wizard.subtitle")}</p>

        {step === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-ink font-medium">{t("wizard.chooseMethod")}</p>
            <button
              onClick={() => setStep("manual")}
              className="w-full text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
              type="button"
            >
              <div className="text-sm font-semibold text-ink">{t("wizard.manualOption")}</div>
            </button>
            <button
              onClick={() => void goAuto()}
              className="w-full text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
              type="button"
            >
              <div className="text-sm font-semibold text-ink">{t("wizard.autoOption")}</div>
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className="w-full text-xs text-ink-soft hover:underline mt-4"
              type="button"
            >
              {t("wizard.skipForNow")}
            </button>
          </div>
        )}

        {step === "manual" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-brand-dark">
              {t("wizard.manualSteps.title")}
            </h3>
            <ol className="list-decimal list-inside text-sm text-ink-muted space-y-1">
              <li>{t("wizard.manualSteps.step1")}</li>
              <li>{t("wizard.manualSteps.step2")}</li>
              <li>{t("wizard.manualSteps.step3")}</li>
              <li>{t("wizard.manualSteps.step4")}</li>
            </ol>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={t("wizard.manualSteps.tokenInputPlaceholder")}
              className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono mt-3"
            />
            {error && <p className="text-xs text-semantic-danger">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("choose")}
                className="px-4 py-2 text-sm text-ink hover:bg-surface-soft rounded"
                type="button"
              >
                {t("wizard.back")}
              </button>
              <button
                onClick={() => void saveManual()}
                disabled={tokenInput.length === 0}
                className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
                type="button"
              >
                {t("wizard.manualSteps.continue")}
              </button>
            </div>
          </div>
        )}

        {step === "auto" && (
          <div className="space-y-3">
            {!autoSearched && <p className="text-sm text-ink-muted">{t("wizard.autoSearching")}</p>}
            {autoSearched && autoPrefix !== null && (
              <>
                <p className="text-sm text-ink">{t("wizard.autoFound")}</p>
                <code className="block text-xs bg-surface-soft p-2 rounded text-ink-muted">
                  {autoPrefix}
                </code>
              </>
            )}
            {autoSearched && autoPrefix === null && (
              <p className="text-sm text-ink-muted">{t("wizard.autoNotFound")}</p>
            )}
            {error && <p className="text-xs text-semantic-danger">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("choose")}
                className="px-4 py-2 text-sm text-ink hover:bg-surface-soft rounded"
                type="button"
              >
                {t("wizard.back")}
              </button>
              {autoSearched && autoPrefix !== null && (
                <button
                  onClick={() => void importAuto()}
                  className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded"
                  type="button"
                >
                  {t("wizard.autoConfirm")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
