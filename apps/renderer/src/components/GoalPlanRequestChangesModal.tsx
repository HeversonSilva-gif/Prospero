import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";

export type GoalPlanRequestChangesModalProps = {
  onClose: () => void;
  onSubmit: (feedback: string) => Promise<void>;
};

export const GoalPlanRequestChangesModal: FC<GoalPlanRequestChangesModalProps> = ({
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (feedback.trim().length === 0) {
      setError(t("goals.plan.requestChanges.errorEmpty"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(feedback.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-card border border-surface-border rounded-lg p-5 max-w-lg w-full">
        <h2 className="text-lg font-bold text-brand-dark mb-2">
          {t("goals.plan.requestChanges.title")}
        </h2>
        <p className="text-sm text-ink-muted mb-3">{t("goals.plan.requestChanges.subtitle")}</p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          autoFocus
          rows={5}
          className="w-full px-3 py-2 border border-surface-border rounded bg-surface text-sm"
          placeholder={t("goals.plan.requestChanges.placeholder")}
          maxLength={5000}
        />
        {error !== null && <p className="text-sm text-semantic-danger mt-2">{error}</p>}
        <div className="flex gap-3 mt-4 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-ink-muted hover:underline"
            disabled={submitting}
          >
            {t("goals.plan.requestChanges.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="px-3 py-1.5 bg-brand text-brand-fg text-sm rounded font-semibold disabled:opacity-50"
          >
            {submitting
              ? t("goals.plan.requestChanges.submitting")
              : t("goals.plan.requestChanges.submit")}
          </button>
        </div>
      </div>
    </div>
  );
};
