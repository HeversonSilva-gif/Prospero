// Inline-editable form for the 4 budget caps. Validation is server-side
// (PR-A throws on non-positive-int); we surface the error inline.

import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useBudgetsStore } from "../../stores/budgets.js";

const FIELDS = [
  "maxTokensPerDayPerAgent",
  "maxTokensPerIssue",
  "rateLimitWindowTokens",
  "rateLimitWindowHours",
] as const;
type Field = (typeof FIELDS)[number];

export const BudgetsForm: FC = () => {
  const { t } = useTranslation();
  const budgets = useBudgetsStore((s) => s.budgets);
  const loaded = useBudgetsStore((s) => s.loaded);
  const load = useBudgetsStore((s) => s.load);
  const save = useBudgetsStore((s) => s.save);

  const [drafts, setDrafts] = useState<Record<Field, string>>({
    maxTokensPerDayPerAgent: "",
    maxTokensPerIssue: "",
    rateLimitWindowTokens: "",
    rateLimitWindowHours: "",
  });
  const [errors, setErrors] = useState<Record<Field, string | null>>({
    maxTokensPerDayPerAgent: null,
    maxTokensPerIssue: null,
    rateLimitWindowTokens: null,
    rateLimitWindowHours: null,
  });
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loaded) {
      setDrafts({
        maxTokensPerDayPerAgent: String(budgets.maxTokensPerDayPerAgent),
        maxTokensPerIssue: String(budgets.maxTokensPerIssue),
        rateLimitWindowTokens: String(budgets.rateLimitWindowTokens),
        rateLimitWindowHours: String(budgets.rateLimitWindowHours),
      });
    }
  }, [loaded, budgets]);

  const onSave = async (field: Field): Promise<void> => {
    const raw = drafts[field];
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      setErrors((e) => ({ ...e, [field]: t("settings.budgets.errorPositive") }));
      return;
    }
    setErrors((e) => ({ ...e, [field]: null }));
    try {
      await save({ [field]: n });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setErrors((e) => ({ ...e, [field]: (err as Error).message }));
    }
  };

  const onReset = async (): Promise<void> => {
    await save({
      maxTokensPerDayPerAgent: 2_000_000,
      maxTokensPerIssue: 200_000,
      rateLimitWindowTokens: 1_000_000,
      rateLimitWindowHours: 5,
    });
  };

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-1">
        {t("settings.budgets.title")}
      </h2>
      <p className="text-xs text-ink-muted mb-3">{t("settings.budgets.subtitle")}</p>
      <dl className="space-y-3">
        {FIELDS.map((field) => (
          <div key={field}>
            <dt className="text-xs text-ink-muted mb-1">{t(`settings.budgets.${field}`)}</dt>
            <dd className="flex gap-2 items-center">
              <input
                type="number"
                min="1"
                step="1"
                value={drafts[field]}
                onChange={(e) => setDrafts((d) => ({ ...d, [field]: e.target.value }))}
                onBlur={() => void onSave(field)}
                className="px-3 py-1.5 bg-surface-soft border border-surface-border rounded text-sm font-mono w-48"
              />
              {errors[field] !== null && (
                <span className="text-xs text-semantic-danger">{errors[field]}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex gap-3 items-center">
        <button
          type="button"
          onClick={() => void onReset()}
          className="text-xs text-ink-muted hover:text-brand underline"
        >
          {t("settings.budgets.reset")}
        </button>
        {savedFlash && (
          <span className="text-xs text-semantic-success">{t("settings.budgets.saved")}</span>
        )}
      </div>
    </section>
  );
};
