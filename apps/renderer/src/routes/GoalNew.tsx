import { useEffect, useState, type FC } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GoalLevel } from "@prospero/shared";
import { useGoalsStore } from "../stores/goals.js";
import { useAgentsStore } from "../stores/agents.js";

const LEVELS: GoalLevel[] = ["company", "team", "agent", "task"];

const useCompanyId = (): string | null => {
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const companies = await window.prospero.companies.list();
      if (companies.length > 0) setCompanyId(companies[0]!.id);
    })();
  }, []);
  return companyId;
};

export const GoalNew: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useCompanyId();
  const agents = useAgentsStore((s) => s.agents);
  const goals = useGoalsStore((s) => s.goals);
  const loadGoals = useGoalsStore((s) => s.load);
  const create = useGoalsStore((s) => s.create);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<GoalLevel>("task");
  const [ownerAgentId, setOwnerAgentId] = useState("");
  const [parentGoalId, setParentGoalId] = useState("");
  const [deadlineStr, setDeadlineStr] = useState("");
  const [budget, setBudget] = useState("");
  const [criteria, setCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyId !== null) {
      void loadGoals(companyId);
    }
  }, [companyId, loadGoals]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (companyId === null) return;
    if (title.trim().length === 0) {
      setError(t("goals.new.errors.titleRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        companyId,
        title: title.trim(),
        description: description.trim().length > 0 ? description.trim() : null,
        level,
        ownerAgentId: ownerAgentId.length > 0 ? ownerAgentId : null,
        parentGoalId: parentGoalId.length > 0 ? parentGoalId : null,
        deadline: deadlineStr.length > 0 ? new Date(deadlineStr).getTime() : null,
        budgetMaxTokens:
          budget.length > 0 && Number.isFinite(Number(budget)) ? Number(budget) : null,
        successCriteria: criteria.trim().length > 0 ? criteria.trim() : null,
      };
      const goal = await create(input);
      navigate(`/goals/${goal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink">{t("pedir.title")}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t("pedir.subtitle")}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 lg:col-span-2">
          <div>
            <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
              {t("goals.new.fields.title")}
              <span className="text-semantic-danger ml-1">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
              placeholder={t("goals.new.placeholders.title")}
              maxLength={200}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
              {t("goals.new.fields.description")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
              rows={3}
              placeholder={t("goals.new.placeholders.description")}
              maxLength={5000}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
                {t("goals.new.fields.level")}
              </label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as GoalLevel)}
                className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`goals.level.${l}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
                {t("goals.new.fields.deadline")}
              </label>
              <input
                type="date"
                value={deadlineStr}
                onChange={(e) => setDeadlineStr(e.target.value)}
                className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
                {t("goals.new.fields.owner")}
              </label>
              <select
                value={ownerAgentId}
                onChange={(e) => setOwnerAgentId(e.target.value)}
                className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
              >
                <option value="">{t("goals.new.placeholders.noOwner")}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
                {t("goals.new.fields.parent")}
              </label>
              <select
                value={parentGoalId}
                onChange={(e) => setParentGoalId(e.target.value)}
                className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
              >
                <option value="">{t("goals.new.placeholders.noParent")}</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
              {t("goals.new.fields.budget")}
            </label>
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
              placeholder={t("goals.new.placeholders.budget")}
              min={0}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
              {t("goals.new.fields.criteria")}
            </label>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
              rows={2}
              placeholder={t("goals.new.placeholders.criteria")}
              maxLength={2000}
            />
          </div>

          {error !== null && (
            <p className="text-sm text-semantic-danger bg-semantic-danger/10 rounded p-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting || title.trim().length === 0}
              className="px-4 py-2 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t("goals.new.submitting") : t("goals.new.submit")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/goals")}
              className="px-4 py-2 text-sm text-ink-muted hover:underline"
            >
              {t("goals.new.cancel")}
            </button>
          </div>
        </form>

        <aside className="lg:col-span-1 bg-surface-card border border-surface-border rounded-xl p-5 h-fit lg:sticky lg:top-6">
          <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
            {t("pedir.panel.title")}
          </h2>
          <ol className="mt-3 space-y-3 text-sm text-ink">
            {(t("pedir.panel.steps", { returnObjects: true }) as string[]).map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-brand-bg text-brand text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
};

export default GoalNew;
