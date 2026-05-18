import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settings.js";

// USER.md prompt cap — mirrors USER_CAP in apps/main system-prompt-memory.ts.
// The counter is cosmetic; the injection site hard-truncates regardless.
const USER_MEMORY_CAP = 1024;

// M11 PR-F2: Settings card — the global user.md editor + the derivation budget.
export const MemorySettingsSection: FC = () => {
  const { t } = useTranslation();
  const derivations = useSettingsStore((s) => s.settings.derivationsPerDayPerAgent);
  const setDerivationsPerDay = useSettingsStore((s) => s.setDerivationsPerDay);

  const [userMemory, setUserMemory] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.prospero.learning.getUserMemory().then((r) => setUserMemory(r.content));
  }, []);

  const onSave = async (): Promise<void> => {
    setSaveError(null);
    setSaving(true);
    try {
      await window.prospero.learning.setUserMemory(userMemory);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onImport = async (): Promise<void> => {
    const r = await window.prospero.learning.importClaudeCodeMemory();
    setUserMemory(r.content);
    setDirty(true);
    setSaved(false);
  };

  const overCap = userMemory.length > USER_MEMORY_CAP;

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">{t("settings.memory.title")}</h2>
      <p className="text-xs text-ink-muted mb-3">{t("settings.memory.subtitle")}</p>

      <label className="block text-sm font-medium text-ink mb-1">
        {t("settings.memory.userMemoryLabel")}
      </label>
      <textarea
        value={userMemory}
        onChange={(e) => {
          setUserMemory(e.target.value);
          setDirty(true);
          setSaved(false);
        }}
        rows={6}
        className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
      />
      <div className="flex items-center gap-2 mt-1">
        <span className={overCap ? "text-xs text-semantic-danger" : "text-xs text-ink-muted"}>
          {userMemory.length} / {USER_MEMORY_CAP}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void onImport()}
          className="px-3 py-1.5 text-sm border border-surface-border rounded"
        >
          {t("settings.memory.import")}
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!dirty || saving}
          className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
        >
          {t("settings.memory.save")}
        </button>
      </div>
      {saved && <p className="mt-1 text-xs text-semantic-success">{t("settings.memory.saved")}</p>}
      {saveError !== null && <p className="mt-1 text-xs text-semantic-danger">{saveError}</p>}
      {overCap && (
        <p className="mt-1 text-xs text-semantic-danger">{t("settings.memory.overCap")}</p>
      )}

      <label className="block text-sm font-medium text-ink mt-4 mb-1">
        {t("settings.memory.derivationBudgetLabel")}
      </label>
      <p className="text-xs text-ink-muted mb-2">{t("settings.memory.derivationBudgetHint")}</p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={10}
          value={derivations}
          onChange={(e) => void setDerivationsPerDay(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-sm font-mono text-ink w-8 text-right">{derivations}</span>
      </div>
    </section>
  );
};
