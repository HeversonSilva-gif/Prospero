import { useEffect, useMemo, useState, type FC } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GoalWithPlan } from "@prospero/shared";
import { computeFilteredEstimates, type PlanFilter } from "../lib/planValidation.js";

const fmtCents = (cents: number): string => `R$ ${(cents / 100).toFixed(2)}`;

// M16 gap #3 — dedicated plain-language plan review (mockup option 2). Reuses
// the GoalPlan data + computeFilteredEstimates; approve/adjust map to the
// existing goals backend. "Quero ajustar" returns to the conversation, where
// "Refazer o plano" re-runs requestPlan (it supersedes the proposed plan).
export const PlanoRevisao: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { goalId } = useParams<{ goalId: string }>();
  const [goal, setGoal] = useState<GoalWithPlan | null>(null);
  const [filter, setFilter] = useState<PlanFilter | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (goalId === undefined) return;
      const g = await window.prospero.goals.get({ id: goalId });
      setGoal(g);
      if (g.currentPlan !== null) {
        setFilter({
          includedAgentIndexes: new Set(g.currentPlan.agentsToHire.map((a) => a.index)),
          includedIssueIndexes: new Set(g.currentPlan.issuesToCreate.map((i) => i.index)),
        });
      }
    })();
  }, [goalId]);

  const plan = goal?.currentPlan ?? null;
  const estimates = useMemo(
    () => (plan !== null && filter !== null ? computeFilteredEstimates(plan, filter) : null),
    [plan, filter],
  );

  if (goalId === undefined) return null;

  if (plan === null || filter === null) {
    return (
      <div className="p-8 max-w-2xl">
        <button
          type="button"
          onClick={() => navigate(`/pedir/${goalId}`)}
          className="text-xs text-brand hover:underline mb-3"
        >
          ← {t("pedir.plano.backToChat")}
        </button>
        <p className="text-sm text-ink-muted">{t("pedir.plano.notReady")}</p>
      </div>
    );
  }

  const toggleAgent = (idx: number) =>
    setFilter((cur) => {
      if (cur === null) return cur;
      const next = new Set(cur.includedAgentIndexes);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...cur, includedAgentIndexes: next };
    });
  const toggleIssue = (idx: number) =>
    setFilter((cur) => {
      if (cur === null) return cur;
      const next = new Set(cur.includedIssueIndexes);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...cur, includedIssueIndexes: next };
    });

  const approve = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const opts: {
        includeAgentIndexes?: number[];
        includeIssueIndexes?: number[];
        mode?: "atomic";
      } = { mode: "atomic" };
      if (filter.includedAgentIndexes.size < plan.agentsToHire.length) {
        opts.includeAgentIndexes = [...filter.includedAgentIndexes];
      }
      if (filter.includedIssueIndexes.size < plan.issuesToCreate.length) {
        opts.includeIssueIndexes = [...filter.includedIssueIndexes];
      }
      const result = await window.prospero.goals.approvePlan({ planId: plan.id, ...opts });
      if (result.ok) navigate("/projects");
      else setError(`${result.failedAtStep}: ${result.error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-8 py-5 border-b border-surface-border bg-surface">
        <button
          type="button"
          onClick={() => navigate(`/pedir/${goalId}`)}
          className="text-xs text-brand hover:underline"
        >
          ← {t("pedir.plano.backToChat")}
        </button>
        <h1 className="mt-1 text-2xl font-bold text-ink">{t("pedir.plano.title")}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t("pedir.plano.for")}: {goal?.title}
        </p>
      </header>

      <div className="flex-1 overflow-auto p-8 max-w-2xl w-full mx-auto space-y-6">
        <section>
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-ink-soft mb-2">
            {t("pedir.plano.whatWillBeDone")}
          </h2>
          {plan.issuesToCreate.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("pedir.plano.empty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {plan.issuesToCreate.map((i) => (
                <li key={i.index} className="flex items-center gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={filter.includedIssueIndexes.has(i.index)}
                    onChange={() => toggleIssue(i.index)}
                    className="w-4 h-4"
                  />
                  <span
                    className={
                      filter.includedIssueIndexes.has(i.index) ? "" : "opacity-50 line-through"
                    }
                  >
                    {i.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-ink-soft mb-2">
            {t("pedir.plano.whoWillDo")}
          </h2>
          {plan.agentsToHire.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("pedir.plano.noHires")}</p>
          ) : (
            <ul className="space-y-1.5">
              {plan.agentsToHire.map((a) => (
                <li key={a.index} className="flex items-center gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={filter.includedAgentIndexes.has(a.index)}
                    onChange={() => toggleAgent(a.index)}
                    className="w-4 h-4"
                  />
                  <span className={filter.includedAgentIndexes.has(a.index) ? "" : "opacity-50"}>
                    {a.name} <span className="text-ink-soft">· {a.roleTemplateId}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-ink-soft mb-2">
            {t("pedir.plano.timeAndCost")}
          </h2>
          <p className="text-sm text-ink-muted">
            {estimates?.durationDays != null &&
              t("pedir.plano.days", { count: estimates.durationDays })}
            {estimates?.durationDays != null && estimates.costCents != null && " · "}
            {estimates?.costCents != null &&
              t("pedir.plano.cost", { value: fmtCents(estimates.costCents) })}
          </p>
        </section>
      </div>

      <div className="px-8 py-4 border-t border-surface-border flex gap-3">
        <button
          type="button"
          onClick={() => void approve()}
          disabled={submitting}
          className="px-4 py-2 bg-semantic-success text-white text-sm rounded font-semibold disabled:opacity-50"
        >
          {submitting ? t("pedir.plano.approving") : t("pedir.plano.approve")}
        </button>
        <button
          type="button"
          onClick={() => navigate(`/pedir/${goalId}`)}
          className="px-4 py-2 bg-surface-soft text-ink-muted text-sm rounded font-semibold"
        >
          {t("pedir.plano.adjust")}
        </button>
        {error !== null && <p className="basis-full text-sm text-semantic-danger">{error}</p>}
      </div>
    </div>
  );
};

export default PlanoRevisao;
