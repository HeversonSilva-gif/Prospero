import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../stores/companies.js";

type Props = { onClose: () => void };

export const CreateCompanyModal = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const create = useCompaniesStore((s) => s.create);
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
      await create(trimmed);
      onClose();
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
        <h2 className="text-lg font-semibold mb-4">{t("company.create.title")}</h2>
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
