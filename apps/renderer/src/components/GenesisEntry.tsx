import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Compass, Lightbulb, ArrowRight, ShieldCheck } from "@phosphor-icons/react";
import { useCompaniesStore } from "../stores/companies.js";

export type GenesisDoor = "ajuda" | "ideia";
type Props = {
  onClose?: () => void;
  onCreated?: (companyId: string, door: GenesisDoor) => void;
  // "modal" (default) renders the full overlay + title (CompanySwitcher).
  // "inline" renders just the two doors, to drop inside another card's body
  // (the first-run SetupWizard, which supplies its own header).
  variant?: "modal" | "inline";
};

export const GenesisEntry = ({ onClose, onCreated, variant = "modal" }: Props) => {
  const { t } = useTranslation();
  const createOnboarding = useCompaniesStore((s) => s.createOnboarding);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (door: GenesisDoor): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = await createOnboarding(t("genesis.placeholderName"));
      onClose?.();
      onCreated?.(created.id, door);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const doors = (
    <div className="space-y-3">
      {[
        { door: "ajuda" as const, icon: <Compass size={22} />, key: "genesis.entry.help" },
        { door: "ideia" as const, icon: <Lightbulb size={22} />, key: "genesis.entry.idea" },
      ].map(({ door, icon, key }) => (
        <button
          key={door}
          type="button"
          disabled={busy}
          onClick={() => void pick(door)}
          className="w-full text-left p-5 bg-surface-card border border-surface-border rounded-2xl hover:border-brand hover:shadow-[0_8px_22px_-10px_rgba(15,118,110,.3)] transition disabled:opacity-50 flex items-start gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <span
            className="w-11 h-11 rounded-xl bg-brand-bg text-brand flex items-center justify-center flex-shrink-0"
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">{t(`${key}.title`)}</div>
            <div className="text-xs text-ink-muted mt-1 leading-relaxed">{t(`${key}.desc`)}</div>
            <div className="text-[12px] font-semibold text-brand mt-2.5 flex items-center gap-1">
              {t(`${key}.go`)} <ArrowRight size={13} aria-hidden="true" />
            </div>
          </div>
        </button>
      ))}
      {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
      <p className="text-[11px] text-ink-soft flex items-center gap-1.5 pt-1">
        <ShieldCheck size={13} aria-hidden="true" /> {t("genesis.entry.trust")}
      </p>
    </div>
  );

  if (variant === "inline") {
    return doors;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface-card rounded-2xl shadow-xl w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink mb-1">{t("genesis.entry.title")}</h2>
        <p className="text-xs text-ink-muted mb-4">{t("genesis.entry.subtitle")}</p>
        {doors}
      </div>
    </div>
  );
};
