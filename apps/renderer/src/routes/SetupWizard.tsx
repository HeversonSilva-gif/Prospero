import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth.js";
import { useSettingsStore } from "../stores/settings.js";
import { useCompaniesStore } from "../stores/companies.js";

type Step = "authSource" | "choose" | "manual" | "auto" | "apiKey" | "company" | "confirm";

export const SetupWizard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const setApiKey = useAuthStore((s) => s.setApiKey);
  const importDetected = useAuthStore((s) => s.importDetected);
  const hasToken = useAuthStore((s) => s.status.hasToken);
  const setAuthMode = useSettingsStore((s) => s.setAuthMode);
  const createCompany = useCompaniesStore((s) => s.createOnboarding);
  // If the user is already authenticated (e.g. relaunch with no company yet),
  // skip straight to creating their company.
  const [step, setStep] = useState<Step>(hasToken ? "company" : "authSource");
  const [tokenInput, setTokenInput] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyDesc, setCompanyDesc] = useState("");
  const [creating, setCreating] = useState(false);
  // We only ever hold the masked prefix in renderer state — never the raw token.
  // The actual import is done main-side via importDetected (re-runs detection + saves).
  const [autoPrefix, setAutoPrefix] = useState<string | null>(null);
  const [autoSearched, setAutoSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goAuto = async () => {
    setStep("auto");
    setError(null);
    const result = await window.prospero.auth.detect();
    setAutoPrefix(result.found ? result.maskedPrefix : null);
    setAutoSearched(true);
  };

  const importAuto = async () => {
    if (autoPrefix === null) return;
    try {
      await importDetected();
      setStep("company");
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  const saveManual = async () => {
    setError(null);
    try {
      await setToken(tokenInput, "manual");
      setStep("company");
    } catch {
      setError(t("settings.auth.tokenInvalid"));
    }
  };

  const createCompanyAndFinish = async () => {
    const name = companyName.trim();
    if (name.length === 0) return;
    setError(null);
    setCreating(true);
    try {
      await createCompany(name, companyDesc.trim() === "" ? undefined : companyDesc.trim());
      navigate("/briefing");
    } catch (err) {
      setCreating(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 3-step wizard (mockup A): 1 connect account · 2 about the business ·
  // 3 review & create. The auth sub-steps (choose/manual/auto/apiKey) are step 1.
  const wizardStep = step === "confirm" || creating ? 3 : step === "company" ? 2 : 1;

  return (
    // flex-1 fills the Shell content row; without a width the card hugged the
    // left instead of centering. flex-col stacks the progress bar over the card.
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-surface-soft overflow-auto">
      <div className="flex gap-2 mb-5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`w-7 h-1.5 rounded-full ${n <= wizardStep ? "bg-brand" : "bg-surface-border"}`}
          />
        ))}
      </div>
      <div className="max-w-xl w-full bg-surface-card border border-surface-border rounded-xl p-8 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand mb-1">
          {t("boasVindas.stepLabel", { n: wizardStep })}
        </p>
        <h1 className="text-2xl font-bold text-ink mb-2">{t("boasVindas.title")}</h1>
        <p className="text-sm text-ink-soft mb-6">{t("boasVindas.subtitle")}</p>

        {step === "authSource" && (
          <div className="space-y-3">
            <p className="text-sm text-ink font-medium">{t("wizard.authSource.title")}</p>
            <p className="text-xs text-ink-muted">{t("wizard.authSource.subtitle")}</p>
            <button
              onClick={() =>
                void setAuthMode("oauth").then(() => {
                  setStep("choose");
                })
              }
              className="w-full text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
              type="button"
            >
              <div className="text-sm font-semibold text-ink">
                {t("wizard.authSource.oauthTitle")}
              </div>
              <div className="text-xs text-ink-muted mt-1">{t("wizard.authSource.oauthDesc")}</div>
            </button>
            <button
              onClick={() =>
                void setAuthMode("api-key").then(() => {
                  setStep("apiKey");
                })
              }
              className="w-full text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
              type="button"
            >
              <div className="text-sm font-semibold text-ink">
                {t("wizard.authSource.apiKeyTitle")}
              </div>
              <div className="text-xs text-ink-muted mt-1">{t("wizard.authSource.apiKeyDesc")}</div>
            </button>
          </div>
        )}

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
                onClick={() => setStep("authSource")}
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
                onClick={() => setStep("authSource")}
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

        {step === "apiKey" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-brand-dark">{t("wizard.apiKey.title")}</h3>
            <p className="text-xs text-ink-muted">{t("wizard.apiKey.subtitle")}</p>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={t("wizard.apiKey.placeholder")}
              className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono mt-3"
            />
            {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("authSource")}
                className="px-4 py-2 text-sm text-ink hover:bg-surface-soft rounded"
                type="button"
              >
                {t("wizard.back")}
              </button>
              <button
                onClick={async () => {
                  setError(null);
                  try {
                    await setApiKey(apiKeyInput);
                    setStep("company");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t("settings.auth.tokenInvalid"));
                  }
                }}
                disabled={apiKeyInput.length === 0}
                className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
                type="button"
              >
                {t("wizard.apiKey.save")}
              </button>
            </div>
          </div>
        )}

        {step === "company" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-brand-dark">
              {t("boasVindas.company.title")}
            </h3>
            <p className="text-xs text-ink-muted">{t("boasVindas.company.subtitle")}</p>
            <label className="block text-xs font-medium text-ink mt-2">
              {t("boasVindas.company.nameLabel")}
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t("boasVindas.company.namePlaceholder")}
              disabled={creating}
              className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm"
            />
            <label className="block text-xs font-medium text-ink mt-2">
              {t("boasVindas.company.descLabel")}
            </label>
            <textarea
              value={companyDesc}
              onChange={(e) => setCompanyDesc(e.target.value)}
              placeholder={t("boasVindas.company.descPlaceholder")}
              disabled={creating}
              rows={4}
              className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm resize-none"
            />
            {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  if (companyName.trim().length === 0) {
                    setError(t("boasVindas.company.errorEmpty"));
                    return;
                  }
                  setError(null);
                  setStep("confirm");
                }}
                disabled={companyName.trim().length === 0}
                className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
                type="button"
              >
                {t("boasVindas.company.continue")}
              </button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-brand-dark">
              {t("boasVindas.confirm.title")}
            </h3>
            <p className="text-xs text-ink-muted">{t("boasVindas.confirm.subtitle")}</p>
            <dl className="mt-2 rounded-lg border border-surface-border bg-surface-soft p-3 text-sm space-y-2">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">
                  {t("boasVindas.company.nameLabel")}
                </dt>
                <dd className="text-ink">{companyName.trim()}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">
                  {t("boasVindas.company.descLabel")}
                </dt>
                <dd className="text-ink whitespace-pre-wrap">
                  {companyDesc.trim() === "" ? "—" : companyDesc.trim()}
                </dd>
              </div>
            </dl>
            {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => {
                  setError(null);
                  setStep("company");
                }}
                disabled={creating}
                className="px-4 py-2 text-sm text-ink hover:bg-surface-soft rounded disabled:opacity-50"
                type="button"
              >
                {t("wizard.back")}
              </button>
              <button
                onClick={() => void createCompanyAndFinish()}
                disabled={creating}
                className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
                type="button"
              >
                {creating ? t("boasVindas.company.creating") : t("boasVindas.company.create")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
