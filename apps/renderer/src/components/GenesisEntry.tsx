import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../stores/companies.js";

export type GenesisDoor = "ajuda" | "ideia";
type Props = { onClose: () => void; onCreated?: (companyId: string, door: GenesisDoor) => void };

export const GenesisEntry = ({ onClose, onCreated }: Props) => {
  const { t } = useTranslation();
  const createOnboarding = useCompaniesStore((s) => s.createOnboarding);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (door: GenesisDoor): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = await createOnboarding(t("genesis.placeholderName"));
      onClose();
      onCreated?.(created.id, door);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">{t("genesis.entry.title")}</h2>
        <p className="text-xs text-ink-muted mb-4">{t("genesis.entry.subtitle")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void pick("ajuda")}
          className="w-full text-left p-4 mb-3 border border-surface-border rounded hover:border-brand disabled:opacity-50"
        >
          <div className="text-sm font-semibold text-ink">{t("genesis.entry.help.title")}</div>
          <div className="text-xs text-ink-muted mt-1">{t("genesis.entry.help.desc")}</div>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void pick("ideia")}
          className="w-full text-left p-4 border border-surface-border rounded hover:border-brand disabled:opacity-50"
        >
          <div className="text-sm font-semibold text-ink">{t("genesis.entry.idea.title")}</div>
          <div className="text-xs text-ink-muted mt-1">{t("genesis.entry.idea.desc")}</div>
        </button>
        {error !== null && <p className="mt-2 text-xs text-semantic-danger">{error}</p>}
      </div>
    </div>
  );
};
