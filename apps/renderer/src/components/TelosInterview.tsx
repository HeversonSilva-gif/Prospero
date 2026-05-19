import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { TelosInterviewAnswers } from "@prospero/shared";
import { useTelosStore } from "../stores/telos.js";

// The guided TELOS interview — five questions, one form. On submit the answers
// are synthesized by AI into a draft TELOS the user then reviews. Shown by the
// /telos route when the company has no TELOS yet.

const QUESTION_KEYS = ["purpose", "growth", "principles", "idealState", "nonGoals"] as const;

const EMPTY: TelosInterviewAnswers = {
  purpose: "",
  growth: "",
  principles: "",
  idealState: "",
  nonGoals: "",
};

export const TelosInterview: FC = () => {
  const { t } = useTranslation();
  const store = useTelosStore();
  const [answers, setAnswers] = useState<TelosInterviewAnswers>(EMPTY);

  const allBlank = QUESTION_KEYS.every((k) => answers[k].trim() === "");

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-sm font-bold text-ink">{t("telos.interview.title")}</h1>
        <p className="text-xs text-ink-muted">{t("telos.interview.subtitle")}</p>
      </header>

      {store.error !== null && <p className="text-xs text-semantic-danger">{store.error}</p>}

      <div className="space-y-5">
        {QUESTION_KEYS.map((key) => (
          <label key={key} className="block space-y-1">
            <span className="text-xs font-semibold text-ink">
              {t(`telos.interview.${key}.label`)}
            </span>
            <textarea
              className="w-full h-24 text-xs p-2 rounded border border-surface-border bg-surface-card text-ink resize-y"
              placeholder={t(`telos.interview.${key}.placeholder`)}
              value={answers[key]}
              onChange={(e) => setAnswers({ ...answers, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        className="px-4 py-1.5 text-xs rounded bg-brand text-brand-fg disabled:opacity-50"
        disabled={allBlank || store.synthesizing}
        onClick={() => void store.synthesize(answers)}
      >
        {store.synthesizing ? t("telos.interview.generating") : t("telos.interview.generate")}
      </button>
    </div>
  );
};
