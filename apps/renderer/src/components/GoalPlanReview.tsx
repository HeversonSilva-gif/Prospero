import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentToHire,
  Goal,
  GoalPlan,
  IssuePriority,
  IssueToCreate,
} from "@dashboard-agent/shared";
import { useGoalsStore } from "../stores/goals.js";
import { useBudgetsStore } from "../stores/budgets.js";
import { useSettingsStore } from "../stores/settings.js";
import {
  computeFilteredEstimates,
  validatePlanSelection,
  type PlanFilter,
} from "../lib/planValidation.js";
import { GoalPlanRequestChangesModal } from "./GoalPlanRequestChangesModal.js";
import { GoalRejectModal } from "./GoalRejectModal.js";

const PRIORITY_BADGE: Record<IssuePriority, string> = {
  urgent: "bg-semantic-danger text-white",
  high: "bg-semantic-warning/30 text-semantic-warning",
  medium: "bg-brand-bg text-brand",
  low: "bg-surface-soft text-ink-muted",
};

const RISK_TINT: Record<string, string> = {
  high: "border-l-semantic-danger bg-semantic-danger/5",
  medium: "border-l-semantic-warning bg-semantic-warning/5",
  low: "border-l-ink-soft bg-surface-soft",
};

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const formatCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const AgentRow: FC<{
  agent: AgentToHire;
  included: boolean;
  onToggle: () => void;
}> = ({ agent, included, onToggle }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <li
      className={`bg-surface-card border border-surface-border rounded p-3 ${included ? "" : "opacity-50"}`}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={included}
          onChange={onToggle}
          aria-label={t("goals.plan.includeAgent", { name: agent.name })}
          className="w-4 h-4"
        />
        <span className="text-xs text-ink-soft font-mono">#{agent.index}</span>
        <span className="text-sm font-semibold text-brand-dark">{agent.name}</span>
        <span className="text-xs text-ink-muted">· {agent.roleTemplateId}</span>
        <span className="text-xs text-ink-muted">· {agent.model}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-xs text-brand hover:underline"
        >
          {expanded ? t("goals.plan.collapse") : t("goals.plan.expand")}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 pl-7 text-xs text-ink-muted space-y-1">
          <p>
            <span className="font-semibold text-ink-soft uppercase tracking-wide">
              {t("goals.plan.agentFields.persona")}:
            </span>{" "}
            <span className="whitespace-pre-wrap">{agent.personaSummary}</span>
          </p>
          <p>
            <span className="font-semibold text-ink-soft uppercase tracking-wide">
              {t("goals.plan.agentFields.skills")}:
            </span>{" "}
            {agent.skills.join(", ")}
          </p>
          <p>
            <span className="font-semibold text-ink-soft uppercase tracking-wide">
              {t("goals.plan.agentFields.reportsTo")}:
            </span>{" "}
            {agent.reportsToIndex === "CEO" ? "CEO" : `#${agent.reportsToIndex}`}
          </p>
          <p>
            <span className="font-semibold text-ink-soft uppercase tracking-wide">
              {t("goals.plan.agentFields.rationale")}:
            </span>{" "}
            <span className="whitespace-pre-wrap">{agent.rationale}</span>
          </p>
        </div>
      )}
    </li>
  );
};

const IssueRow: FC<{
  issue: IssueToCreate;
  included: boolean;
  onToggle: () => void;
  agentsByIndex: Map<number, AgentToHire>;
}> = ({ issue, included, onToggle, agentsByIndex }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const assigneeLabel =
    issue.assigneeIndex === "CEO"
      ? "CEO"
      : (agentsByIndex.get(issue.assigneeIndex)?.name ?? `#${issue.assigneeIndex}`);

  return (
    <li
      className={`bg-surface-card border border-surface-border rounded p-3 ${included ? "" : "opacity-50"}`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="checkbox"
          checked={included}
          onChange={onToggle}
          aria-label={t("goals.plan.includeIssue", { title: issue.title })}
          className="w-4 h-4"
        />
        <span className="text-xs text-ink-soft font-mono">#{issue.index}</span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${PRIORITY_BADGE[issue.priority]}`}
        >
          {issue.priority}
        </span>
        <span className="text-sm text-ink flex-1 min-w-0 truncate">{issue.title}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-brand hover:underline"
        >
          {expanded ? t("goals.plan.collapse") : t("goals.plan.expand")}
        </button>
      </div>
      <div className="mt-1 pl-7 text-xs text-ink-muted flex gap-3 flex-wrap">
        <span>
          {t("goals.plan.issueFields.assignee")}: <strong>{assigneeLabel}</strong>
        </span>
        <span>
          {t("goals.plan.issueFields.estimate")}:{" "}
          <strong>{formatTokens(issue.estimatedTokens)}</strong>
        </span>
        {issue.dependsOnIndexes.length > 0 && (
          <span>
            {t("goals.plan.issueFields.deps")}:{" "}
            <strong>{issue.dependsOnIndexes.map((i) => `#${i}`).join(", ")}</strong>
          </span>
        )}
      </div>
      {expanded && (
        <div className="mt-2 pl-7 text-xs text-ink-muted space-y-1">
          <p className="whitespace-pre-wrap">{issue.description}</p>
          <p>
            <span className="font-semibold text-ink-soft uppercase tracking-wide">
              {t("goals.plan.issueFields.rationale")}:
            </span>{" "}
            <span className="whitespace-pre-wrap">{issue.rationale}</span>
          </p>
        </div>
      )}
    </li>
  );
};

type FormatDate = (epochMs: number) => string;
const fmtDate: FormatDate = (n) => new Date(n).toLocaleString();

export const GoalPlanReview: FC<{ plan: GoalPlan; goal: Goal }> = ({ plan, goal }) => {
  const { t } = useTranslation();
  const approvePlan = useGoalsStore((s) => s.approvePlan);
  const requestChanges = useGoalsStore((s) => s.requestChanges);
  const rejectPlan = useGoalsStore((s) => s.rejectPlan);
  const budgets = useBudgetsStore((s) => s.budgets);
  const loadBudgets = useBudgetsStore((s) => s.load);
  const budgetsLoaded = useBudgetsStore((s) => s.loaded);
  const executorMode = useSettingsStore((s) => s.settings.executorMode);

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
  const [risksExpanded, setRisksExpanded] = useState(false);
  const [narratedOverride, setNarratedOverride] = useState(executorMode === "narrated");

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

  return (
    <div className="bg-surface-card border border-surface-border rounded">
      <div className="flex items-center justify-between p-4 border-b border-surface-border">
        <div>
          <p className="text-sm font-semibold text-brand-dark">
            {t("goals.plan.versionLabel", { version: plan.version })}
          </p>
          <p className="text-xs text-ink-soft">
            {t("goals.plan.proposedBy")} · {fmtDate(plan.proposedAt)}
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded bg-brand-bg text-brand">
          {t(`goals.plan.status.${plan.status}`)}
        </span>
      </div>

      <section className="p-4 border-b border-surface-border">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-soft mb-2">
          {t("goals.plan.summary")}
        </h3>
        <p className="text-sm text-ink whitespace-pre-wrap">{plan.summary}</p>
      </section>

      <section className="p-4 border-b border-surface-border">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-soft mb-2">
          {t("goals.plan.agents.title", { count: plan.agentsToHire.length })}
        </h3>
        {plan.agentsToHire.length === 0 ? (
          <p className="text-xs text-ink-muted">{t("goals.plan.agents.none")}</p>
        ) : (
          <ul className="space-y-2">
            {plan.agentsToHire.map((a) => (
              <AgentRow
                key={a.index}
                agent={a}
                included={included.includedAgentIndexes.has(a.index)}
                onToggle={() => toggleAgent(a.index)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="p-4 border-b border-surface-border">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-soft mb-2">
          {t("goals.plan.issues.title", { count: plan.issuesToCreate.length })}
        </h3>
        {plan.issuesToCreate.length === 0 ? (
          <p className="text-xs text-ink-muted">{t("goals.plan.issues.none")}</p>
        ) : (
          <ul className="space-y-2">
            {plan.issuesToCreate.map((i) => (
              <IssueRow
                key={i.index}
                issue={i}
                included={included.includedIssueIndexes.has(i.index)}
                onToggle={() => toggleIssue(i.index)}
                agentsByIndex={agentsByIndex}
              />
            ))}
          </ul>
        )}
      </section>

      {plan.risks.length > 0 && (
        <section className="p-4 border-b border-surface-border">
          <button
            type="button"
            onClick={() => setRisksExpanded((v) => !v)}
            className="text-xs uppercase tracking-wide font-semibold text-ink-soft hover:text-ink"
          >
            {risksExpanded ? "▼" : "▶"} {t("goals.plan.risks.title", { count: plan.risks.length })}
          </button>
          {risksExpanded && (
            <ul className="mt-3 space-y-2">
              {plan.risks.map((r, i) => (
                <li
                  key={i}
                  className={`border-l-4 p-3 rounded text-xs ${RISK_TINT[r.severity] ?? RISK_TINT.low}`}
                >
                  <p className="font-semibold text-ink">{r.description}</p>
                  <p className="text-ink-muted mt-1">
                    <strong>{t("goals.plan.risks.mitigation")}:</strong> {r.mitigation}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="p-4 border-b border-surface-border bg-surface-soft">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-soft mb-2">
          {t("goals.plan.estimates.title")}
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-ink-muted">{t("goals.plan.estimates.totalTokens")}:</dt>
            <dd className="text-ink font-semibold">{formatTokens(estimates.totalTokens)}</dd>
          </div>
          {estimates.costCents !== null && (
            <div className="flex gap-2">
              <dt className="text-ink-muted">{t("goals.plan.estimates.cost")}:</dt>
              <dd className="text-ink font-semibold">{formatCents(estimates.costCents)}</dd>
            </div>
          )}
          {estimates.durationDays !== null && (
            <div className="flex gap-2">
              <dt className="text-ink-muted">{t("goals.plan.estimates.duration")}:</dt>
              <dd className="text-ink font-semibold">
                {t("goals.plan.estimates.days", { count: estimates.durationDays })}
              </dd>
            </div>
          )}
          {dailyPct !== null && (
            <div className="flex gap-2">
              <dt className="text-ink-muted">{t("goals.plan.estimates.dailyBudget")}:</dt>
              <dd className="text-ink font-semibold">{dailyPct}%</dd>
            </div>
          )}
        </dl>
      </section>

      {errors.length > 0 && (
        <section className="p-4 border-b border-surface-border bg-semantic-danger/5">
          <p className="text-xs font-semibold text-semantic-danger uppercase tracking-wide mb-2">
            {t("goals.plan.validation.title")}
          </p>
          <ul className="text-xs text-semantic-danger space-y-1">
            {errors.map((e, i) => (
              <li key={i}>{t(`goals.plan.validation.${e.kind}`, e)}</li>
            ))}
          </ul>
        </section>
      )}

      {editable && (
        <div className="px-4 pt-3 pb-1 text-xs text-ink-muted flex items-center gap-2 flex-wrap">
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
      )}

      {editable && (
        <div className="p-4 flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={approveDisabled}
            className="px-4 py-2 bg-semantic-success text-white text-sm rounded font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t("goals.plan.actions.approving") : t("goals.plan.actions.approve")}
          </button>
          <button
            type="button"
            onClick={() => setShowChanges(true)}
            disabled={submitting}
            className="px-4 py-2 bg-brand text-brand-fg text-sm rounded font-semibold disabled:opacity-50"
          >
            {t("goals.plan.actions.requestChanges")}
          </button>
          <button
            type="button"
            onClick={() => setShowReject(true)}
            disabled={submitting}
            className="px-4 py-2 bg-semantic-danger text-white text-sm rounded font-semibold disabled:opacity-50"
          >
            {t("goals.plan.actions.reject")}
          </button>
          {error !== null && (
            <p className="basis-full text-sm text-semantic-danger mt-2">{error}</p>
          )}
        </div>
      )}

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
    </div>
  );
};
