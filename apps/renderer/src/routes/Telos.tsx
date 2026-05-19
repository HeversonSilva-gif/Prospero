import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { TELOS_SKELETON, validateTelos } from "@prospero/shared";
import { useTelosStore } from "../stores/telos.js";
import { useSettingsStore } from "../stores/settings.js";
import { TelosInterview } from "../components/TelosInterview.js";
import { LoadingState } from "../components/ui/index.js";

// The /telos route. Three states:
//  - no TELOS yet  -> the guided interview (or "write it myself")
//  - a synthesized draft pending review -> apply / discard
//  - a TELOS exists -> a markdown editor with debounced autosave

export const Telos: FC = () => {
  const { t } = useTranslation();
  const { load, body, save, loading, draft, error } = useTelosStore();
  const activeCompanyId = useSettingsStore((s) => s.settings.activeCompanyId);
  const [local, setLocal] = useState("");

  useEffect(() => {
    if (activeCompanyId !== null) void load(activeCompanyId);
  }, [activeCompanyId, load]);

  useEffect(() => {
    setLocal(body ?? "");
  }, [body]);

  // Debounced autosave. The `local === body` guard skips the no-op fired by
  // the body-sync effect (on mount and after a save round-trips back).
  useEffect(() => {
    if (body === null || local === body) return;
    const handle = setTimeout(() => void save(local), 500);
    return () => clearTimeout(handle);
  }, [local, body, save]);

  if (activeCompanyId === null) {
    return <p className="p-6 text-xs text-ink-muted">{t("telos.noCompany")}</p>;
  }
  if (loading) return <LoadingState label={t("telos.loading")} />;

  // A synthesized draft awaiting the user's review.
  if (draft !== null) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h1 className="text-sm font-bold text-ink">{t("telos.draftTitle")}</h1>
        <p className="text-xs text-ink-muted">{t("telos.draftHint")}</p>
        <pre className="w-full text-xs p-3 rounded border border-surface-border bg-surface-card text-ink whitespace-pre-wrap">
          {draft.telos}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1 text-xs rounded bg-brand text-brand-fg"
            onClick={() => void useTelosStore.getState().applyDraft()}
          >
            {t("telos.applyDraft")}
          </button>
          <button
            type="button"
            className="px-3 py-1 text-xs rounded border border-surface-border text-ink-muted"
            onClick={() => useTelosStore.getState().discardDraft()}
          >
            {t("telos.discardDraft")}
          </button>
        </div>
      </div>
    );
  }

  // No TELOS yet — show the interview, with an escape hatch to write it by hand.
  if (body === null) {
    return (
      <div>
        <TelosInterview />
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <button
            type="button"
            className="text-[11px] text-ink-soft underline"
            onClick={() => void save(TELOS_SKELETON)}
          >
            {t("telos.writeManually")}
          </button>
        </div>
      </div>
    );
  }

  // A TELOS exists — the markdown editor.
  const validation = validateTelos(local);
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-3">
      <header className="space-y-1">
        <h1 className="text-sm font-bold text-ink">{t("telos.title")}</h1>
        <p className="text-[10px] text-ink-soft">
          {validation.ok
            ? t("telos.allSectionsPresent")
            : t("telos.missingSections", { sections: validation.missing.join(", ") })}
        </p>
      </header>
      {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
      <textarea
        aria-label={t("telos.title")}
        className="w-full h-96 font-mono text-xs p-3 rounded border border-surface-border bg-surface-card text-ink resize-y"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
};
