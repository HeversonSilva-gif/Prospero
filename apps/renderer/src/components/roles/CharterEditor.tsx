import { type FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { validateCharter } from "@prospero/shared";

type Props = {
  // Charter body for the currently selected role; null while loading.
  body: string | null;
  onSave: (body: string) => Promise<void>;
};

export const CharterEditor: FC<Props> = ({ body, onSave }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>(body ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the draft whenever a different role's charter loads.
  useEffect(() => {
    setDraft(body ?? "");
    setSaved(false);
    setError(null);
  }, [body]);

  const validation = useMemo(() => validateCharter(draft), [draft]);
  const dirty = draft !== (body ?? "");

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (body === null) {
    return <p className="text-xs text-ink-muted">…</p>;
  }

  return (
    <div className="space-y-2">
      {validation.ok ? (
        <p className="text-[11px] text-emerald-600">{t("roles.charter.complete")}</p>
      ) : (
        <p className="text-[11px] text-amber-600">
          {t("roles.charter.missing", { sections: validation.missing.join(", ") })}
        </p>
      )}
      <textarea
        className="w-full h-96 font-mono text-xs p-3 rounded border border-surface-border bg-surface-soft resize-y"
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
          className="text-xs font-semibold px-3 py-1.5 rounded bg-brand text-white disabled:opacity-40"
        >
          {saving ? t("roles.charter.saving") : t("roles.charter.save")}
        </button>
        {saved && !dirty && (
          <span className="text-[11px] text-ink-muted">{t("roles.charter.saved")}</span>
        )}
        {error !== null && <span className="text-[11px] text-rose-600">{error}</span>}
      </div>
    </div>
  );
};
