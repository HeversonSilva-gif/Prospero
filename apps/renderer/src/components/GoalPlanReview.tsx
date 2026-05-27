import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { AgentToHire, Goal, GoalPlan, IssuePriority, IssueToCreate } from "@prospero/shared";
import type { CriterionKind } from "@prospero/shared";
import { useGoalsStore } from "../stores/goals.js";
import { useBudgetsStore } from "../stores/budgets.js";
import { useSettingsStore } from "../stores/settings.js";
import { useIsaStore } from "../stores/isa.js";
import {
  computeFilteredEstimates,
  validatePlanSelection,
  type PlanFilter,
} from "../lib/planValidation.js";
import { GoalPlanRequestChangesModal } from "./GoalPlanRequestChangesModal.js";
import { GoalRejectModal } from "./GoalRejectModal.js";
import {
  DecisionPage,
  DecisionHeader,
  HeroSummary,
  ItemAccordion,
  DecisionActions,
  IsaCriteriaEditor,
  type AccordionItem,
  type CriterionEntry,
} from "./decision/index.js";

const PRIORITY_BADGE: Record<IssuePriority, { label: string; tone: "high" | "medium" | "low" }> = {
  urgent: { label: "urgent", tone: "high" },
  high: { label: "high", tone: "medium" },
  medium: { label: "medium", tone: "low" },
  low: { label: "low", tone: "low" },
};

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** Formats a Unix-ms timestamp as a relative string, e.g. "4 min". */
const timeAgoLabel = (ts: number): string => {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

// Inline form for adding/editing a criterion within the plan review.
type CriterionFormState =
  | { mode: "hidden" }
  | { mode: "add" }
  | { mode: "edit"; id: string; text: string; kind: CriterionKind };

export const GoalPlanReview: FC<{ plan: GoalPlan; goal: Goal }> = ({ plan, goal }) => {
  const { t } = useTranslation();
  const approvePlan = useGoalsStore((s) => s.approvePlan);
  const requestChanges = useGoalsStore((s) => s.requestChanges);
  const rejectPlan = useGoalsStore((s) => s.rejectPlan);
  const budgets = useBudgetsStore((s) => s.budgets);
  const loadBudgets = useBudgetsStore((s) => s.load);
  const budgetsLoaded = useBudgetsStore((s) => s.loaded);
  const executorMode = useSettingsStore((s) => s.settings.executorMode);

  // ISA criteria — loaded from the ISA store keyed by goal id.
  const isaLoad = useIsaStore((s) => s.load);
  const isaCriteria = useIsaStore((s) => s.criteria);
  const isaAddCriterion = useIsaStore((s) => s.addCriterion);
  const isaUpdateCriterion = useIsaStore((s) => s.updateCriterion);
  const isaRemoveCriterion = useIsaStore((s) => s.removeCriterion);

  useEffect(() => {
    void isaLoad(goal.id);
  }, [goal.id, isaLoad]);

  useEffect(() => {
    if (!budgetsLoaded) {
      void loadBudgets();
    }
  }, [budgetsLoaded, loadBudgets]);

  const [included, setIncluded] = useState<PlanFilter>(() => ({
    includedAgentIndexes: new Set(plan.agentsToHire.map((a) => a.index)),
    includedIssueIndexes: new Set(plan.issuesToCreate.map((i) => i.index)),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [narratedOverride, setNarratedOverride] = useState(executorMode === "narrated");

  // Inline criterion form state.
  const [criterionForm, setCriterionForm] = useState<CriterionFormState>({ mode: "hidden" });
  const [criterionText, setCriterionText] = useState("");
  const [criterionKind, setCriterionKind] = useState<CriterionKind>("judgment");
  const [criterionSaving, setCriterionSaving] = useState(false);

  useEffect(() => {
    setNarratedOverride(executorMode === "narrated");
  }, [executorMode]);

  const agentsByIndex = useMemo(
    () => new Map(plan.agentsToHire.map((a) => [a.index, a])),
    [plan.agentsToHire],
  );

  const errors = useMemo(() => validatePlanSelection(plan, included), [plan, included]);
  const estimates = useMemo(() => computeFilteredEstimates(plan, included), [plan, included]);

  const toggleAgent = (idx: number) =>
    setIncluded((cur) => {
      const next = new Set(cur.includedAgentIndexes);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...cur, includedAgentIndexes: next };
    });

  const toggleIssue = (idx: number) =>
    setIncluded((cur) => {
      const next = new Set(cur.includedIssueIndexes);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...cur, includedIssueIndexes: next };
    });

  const dailyMax = budgets.maxTokensPerDayPerAgent;
  const dailyPct = dailyMax > 0 ? Math.round((estimates.totalTokens / dailyMax) * 100) : null;

  const editable = plan.status === "proposed" && goal.status === "proposed";
  const approveDisabled = !editable || submitting || errors.length > 0;

  const handleApprove = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const opts: {
        includeAgentIndexes?: number[];
        includeIssueIndexes?: number[];
        mode?: "atomic" | "narrated";
      } = {};
      const agentsAll = plan.agentsToHire.length;
      const issuesAll = plan.issuesToCreate.length;
      if (included.includedAgentIndexes.size < agentsAll) {
        opts.includeAgentIndexes = [...included.includedAgentIndexes];
      }
      if (included.includedIssueIndexes.size < issuesAll) {
        opts.includeIssueIndexes = [...included.includedIssueIndexes];
      }
      opts.mode = narratedOverride ? "narrated" : "atomic";
      const result = await approvePlan(plan.id, opts);
      if (!result.ok) {
        setError(`${result.failedAtStep}: ${result.error}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ISA criterion handlers — wired to useIsaStore (full CRUD via IPC).
  const handleAddCriterion = () => {
    setCriterionText("");
    setCriterionKind("judgment");
    setCriterionForm({ mode: "add" });
  };

  const handleEditCriterion = (id: string) => {
    const c = isaCriteria.find((x) => x.id === id);
    if (c === undefined) return;
    setCriterionText(c.statement);
    setCriterionKind(c.kind);
    setCriterionForm({ mode: "edit", id, text: c.statement, kind: c.kind });
  };

  const handleRemoveCriterion = async (id: string) => {
    await isaRemoveCriterion(id);
  };

  const handleCriterionSave = async () => {
    if (criterionText.trim() === "") return;
    setCriterionSaving(true);
    try {
      if (criterionForm.mode === "add") {
        await isaAddCriterion({
          statement: criterionText.trim(),
          kind: criterionKind,
          checkType: null,
          checkSpec: null,
        });
      } else if (criterionForm.mode === "edit") {
        await isaUpdateCriterion(criterionForm.id, {
          statement: criterionText.trim(),
          kind: criterionKind,
          checkType: null,
          checkSpec: null,
        });
      }
      setCriterionForm({ mode: "hidden" });
    } finally {
      setCriterionSaving(false);
    }
  };

  // Map GoalCriterion → CriterionEntry for the editor.
  // CriterionKind "deterministic" → "auto", "judgment" → "human".
  const criteriaEntries: CriterionEntry[] = isaCriteria.map((c) => ({
    id: c.id,
    kind: c.kind === "deterministic" ? "auto" : "human",
    text: c.statement,
    ...(c.kind === "deterministic" && c.checkType !== null ? { rule: c.checkType } : {}),
  }));

  const autoCount = criteriaEntries.filter((c) => c.kind === "auto").length;
  const humanCount = criteriaEntries.filter((c) => c.kind === "human").length;
  const criteriaCount = criteriaEntries.length;

  // Build accordion items for agents.
  const agentItems: AccordionItem[] = plan.agentsToHire.map((a: AgentToHire) => ({
    id: `agent-${String(a.index)}`,
    avatar: { variant: "person" as const, label: a.name.slice(0, 2).toUpperCase() },
    name: a.name,
    sub: `${a.roleTemplateId} · ${a.model}`,
    badges: included.includedAgentIndexes.has(a.index)
      ? []
      : [{ label: t("goals.plan.excluded"), tone: "low" as const }],
    body: (
      <div className="pt-3 space-y-2">
        <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={included.includedAgentIndexes.has(a.index)}
            onChange={() => toggleAgent(a.index)}
            className="w-4 h-4"
          />
          {t("goals.plan.includeAgent", { name: a.name })}
        </label>
        <p className="text-xs text-ink-muted whitespace-pre-wrap">{a.personaSummary}</p>
        <p className="text-xs text-ink-muted whitespace-pre-wrap">{a.rationale}</p>
      </div>
    ),
  }));

  // Build accordion items for issues.
  const issueItems: AccordionItem[] = plan.issuesToCreate.map((i: IssueToCreate) => {
    const assigneeLabel =
      i.assigneeIndex === "CEO"
        ? "CEO"
        : (agentsByIndex.get(i.assigneeIndex)?.name ?? `#${i.assigneeIndex}`);
    const badge = PRIORITY_BADGE[i.priority];
    return {
      id: `issue-${String(i.index)}`,
      avatar: { variant: "issue" as const, label: `#${i.index}` },
      name: i.title,
      sub: `${t("goals.plan.issueFields.assignee")}: ${assigneeLabel} · ${t("goals.plan.issueFields.estimate")}: ${formatTokens(i.estimatedTokens)}`,
      badges: [{ label: badge.label, tone: badge.tone }],
      body: (
        <div className="pt-3 space-y-2">
          <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={included.includedIssueIndexes.has(i.index)}
              onChange={() => toggleIssue(i.index)}
              className="w-4 h-4"
            />
            {t("goals.plan.includeIssue", { title: i.title })}
          </label>
          <p className="text-xs text-ink-muted whitespace-pre-wrap">{i.description}</p>
          {i.dependsOnIndexes.length > 0 && (
            <p className="text-xs text-ink-soft">
              {t("goals.plan.issueFields.deps")}:{" "}
              <strong>{i.dependsOnIndexes.map((d) => `#${d}`).join(", ")}</strong>
            </p>
          )}
          <p className="text-xs text-ink-muted whitespace-pre-wrap">{i.rationale}</p>
        </div>
      ),
    };
  });

  // Parallel issues = issues that have no dependencies.
  const parallelCount = plan.issuesToCreate.filter((i) => i.dependsOnIndexes.length === 0).length;

  const estimatedCostStr = estimates.costCents !== null ? formatCents(estimates.costCents) : "—";
  const tokensStr = formatTokens(estimates.totalTokens);

  return (
    <>
      <DecisionPage
        header={
          <DecisionHeader
            chip={{ variant: "goal", label: t("decision.goalPlan.chip") }}
            meta={t("decision.goalPlan.meta", {
              author: "CEO",
              when: timeAgoLabel(plan.proposedAt),
            })}
            title={plan.summary}
          />
        }
        hero={
          <HeroSummary
            variant="goal"
            stats={[
              {
                label: t("decision.goalPlan.stats.hires"),
                value: String(plan.agentsToHire.length),
                ...(plan.agentsToHire.length === 0
                  ? { sub: t("decision.goalPlan.stats.hiresNone") }
                  : {}),
              },
              {
                label: t("decision.goalPlan.stats.issues"),
                value: String(plan.issuesToCreate.length),
                sub: t("decision.goalPlan.stats.issuesSub", { parallel: parallelCount }),
              },
              {
                label: t("decision.goalPlan.stats.criteria"),
                value: String(criteriaCount),
                sub: t("decision.goalPlan.stats.criteriaSub", {
                  auto: autoCount,
                  human: humanCount,
                }),
              },
              {
                label: t("decision.goalPlan.stats.cost"),
                value: estimatedCostStr,
                sub: t("decision.goalPlan.stats.tokens", { tokens: tokensStr }),
              },
            ]}
          />
        }
        sections={[
          errors.length > 0 ? (
            <section key="errors">
              <ul className="text-xs text-semantic-danger space-y-1 bg-semantic-danger-bg/30 border border-semantic-danger-bg rounded-md px-4 py-3">
                {errors.map((e, idx) => (
                  <li key={idx}>{t(`goals.plan.validation.${e.kind}`, e)}</li>
                ))}
              </ul>
            </section>
          ) : null,
          <section key="isa">
            <header className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
                {t("decision.goalPlan.isaHeading")}{" "}
                <span className="font-normal text-ink-soft normal-case tracking-normal text-xs">
                  · {t("decision.goalPlan.isaEditableHint")}
                </span>
              </h3>
            </header>
            <p className="text-xs text-ink-soft leading-relaxed mb-3.5">
              {t("decision.goalPlan.isaHelp")}
            </p>
            <IsaCriteriaEditor
              criteria={criteriaEntries}
              onAdd={handleAddCriterion}
              onEdit={handleEditCriterion}
              onRemove={(id) => void handleRemoveCriterion(id)}
              addLabel={t("decision.goalPlan.isa.add")}
              editLabel={t("decision.goalPlan.isa.edit")}
              removeLabel={t("decision.goalPlan.isa.remove")}
              autoPillLabel={t("decision.goalPlan.isa.autoPill")}
              humanPillLabel={t("decision.goalPlan.isa.humanPill")}
            />
            {criterionForm.mode !== "hidden" && (
              <div className="mt-3 space-y-2 bg-surface-soft border border-surface-border rounded-lg px-4 py-3">
                <textarea
                  autoFocus
                  rows={2}
                  value={criterionText}
                  onChange={(e) => setCriterionText(e.target.value)}
                  placeholder={t("decision.goalPlan.isa.placeholder")}
                  className="w-full text-xs px-2 py-1.5 border border-surface-border rounded bg-surface text-ink resize-none"
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <select
                    value={criterionKind}
                    onChange={(e) => setCriterionKind(e.target.value as CriterionKind)}
                    className="text-xs px-2 py-1 rounded border border-surface-border bg-surface text-ink"
                  >
                    <option value="judgment">{t("decision.goalPlan.isa.humanPill")}</option>
                    <option value="deterministic">{t("decision.goalPlan.isa.autoPill")}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleCriterionSave()}
                    disabled={criterionSaving || criterionText.trim() === ""}
                    className="px-3 py-1 text-xs bg-brand text-white rounded font-semibold disabled:opacity-50"
                  >
                    {t("decision.goalPlan.isa.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCriterionForm({ mode: "hidden" })}
                    className="px-3 py-1 text-xs text-ink-muted hover:underline"
                  >
                    {t("decision.goalPlan.isa.cancel")}
                  </button>
                </div>
              </div>
            )}
          </section>,
          plan.agentsToHire.length > 0 ? (
            <section key="agents">
              <header className="mb-3">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
                  {t("goals.plan.agents.title", { count: plan.agentsToHire.length })}
                </h3>
              </header>
              <ItemAccordion items={agentItems} />
            </section>
          ) : null,
          <section key="issues">
            <header className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
                {t("decision.goalPlan.issuesHeading", { count: plan.issuesToCreate.length })}
              </h3>
            </header>
            {plan.issuesToCreate.length === 0 ? (
              <p className="text-xs text-ink-muted">{t("goals.plan.issues.none")}</p>
            ) : (
              <ItemAccordion items={issueItems} />
            )}
          </section>,
          plan.risks.length > 0 ? (
            <section key="risks">
              <header className="mb-3">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
                  {t("goals.plan.risks.title", { count: plan.risks.length })}
                </h3>
              </header>
              <ul className="space-y-2">
                {plan.risks.map((r, idx) => (
                  <li
                    key={idx}
                    className={`border-l-4 p-3 rounded text-xs ${
                      r.severity === "high"
                        ? "border-l-semantic-danger bg-semantic-danger/5"
                        : r.severity === "medium"
                          ? "border-l-semantic-warning bg-semantic-warning/5"
                          : "border-l-ink-soft bg-surface-soft"
                    }`}
                  >
                    <p className="font-semibold text-ink">{r.description}</p>
                    <p className="text-ink-muted mt-1">
                      <strong>{t("goals.plan.risks.mitigation")}:</strong> {r.mitigation}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
          editable ? (
            <section key="narrated" className="px-0">
              <div className="text-xs text-ink-muted flex items-center gap-2 flex-wrap">
                <input
                  type="checkbox"
                  id="narrated-toggle"
                  checked={narratedOverride}
                  onChange={(e) => setNarratedOverride(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <label htmlFor="narrated-toggle" className="cursor-pointer">
                  {t("goals.plan.actions.narratedToggle")}
                </label>
                {narratedOverride && estimates.totalTokens > 0 && (
                  <span className="ml-2 text-ink-soft">
                    {t("goals.plan.actions.narratedTokenHint", {
                      base: formatTokens(estimates.totalTokens),
                      narrated: formatTokens(Math.round(estimates.totalTokens * 2.5)),
                    })}
                  </span>
                )}
              </div>
            </section>
          ) : null,
          error !== null ? (
            <p key="error" className="text-sm text-semantic-danger">
              {error}
            </p>
          ) : null,
        ]}
        actions={
          <DecisionActions
            estimates={[
              { label: t("decision.shared.tokens"), value: tokensStr },
              ...(dailyPct !== null
                ? [{ label: t("decision.shared.dailyLimit"), value: `${dailyPct}%` }]
                : []),
              { label: t("decision.shared.cost"), value: estimatedCostStr },
            ]}
            onApprove={() => void handleApprove()}
            {...(editable ? { onRequestChanges: () => setShowChanges(true) } : {})}
            onReject={() => setShowReject(true)}
            approveLabel={
              submitting ? t("goals.plan.actions.approving") : t("decision.shared.approve")
            }
            requestChangesLabel={t("decision.shared.requestChanges")}
            rejectLabel={t("decision.shared.reject")}
            disabled={approveDisabled}
          />
        }
      />

      {showChanges && (
        <GoalPlanRequestChangesModal
          onClose={() => setShowChanges(false)}
          onSubmit={(feedback) => requestChanges(plan.id, feedback)}
        />
      )}

      {showReject && (
        <GoalRejectModal
          onClose={() => setShowReject(false)}
          onSubmit={(reason) => rejectPlan(plan.id, reason ?? undefined)}
        />
      )}
    </>
  );
};
