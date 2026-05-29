import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../stores/companies.js";

// onCreated receives the new company id so the caller can route into the
// conversational onboarding wizard. Kept as a callback so this modal stays
// router-agnostic (CompanySwitcher passes the navigate).
type Props = { onClose: () => void; onCreated?: (companyId: string) => void };

export const CreateCompanyModal = ({ onClose, onCreated }: Props) => {
  const { t } = useTranslation();
  // createOnboarding (not the bare `create`) so the company is born WITH its CEO —
  // otherwise the user lands in an empty company with nothing to do.
  const createOnboarding = useCompaniesStore((s) => s.createOnboarding);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(t("company.create.errorEmpty"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createOnboarding(trimmed);
      onClose();
      onCreated?.(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">{t("company.create.title")}</h2>
        <p className="text-xs text-ink-muted mb-4">{t("company.create.onboardingHint")}</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("company.create.namePlaceholder")}
          autoFocus
          disabled={busy}
          className="w-full px-3 py-2 text-sm border border-surface-border rounded bg-surface-soft focus:outline-none focus:border-brand"
        />
        {error !== null && <p className="mt-2 text-xs text-semantic-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-soft rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
          >
            {busy ? t("company.create.submitting") : t("company.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
};
