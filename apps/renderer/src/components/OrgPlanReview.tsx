import { type FC, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ApplyOrgPlanResult, OrgPlan } from "@prospero/shared";
import { useOrgPlanStore } from "../stores/orgPlan.js";
import { useAgentsStore } from "../stores/agents.js";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";
import { validateOrgPlanSelection, type OrgPlanFilter } from "../lib/orgPlanValidation.js";
import {
  DecisionPage,
  DecisionHeader,
  HeroSummary,
  ItemAccordion,
  DecisionActions,
  type AccordionItem,
} from "./decision/index.js";

/** Formats a Unix-ms timestamp as a relative string, e.g. "4 min". */
const timeAgoLabel = (ts: number): string => {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

export const OrgPlanReview: FC<{ plan: OrgPlan }> = ({ plan }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useActiveCompanyId();
  const approve = useOrgPlanStore((s) => s.approve);
  const reject = useOrgPlanStore((s) => s.reject);
  const loadAgents = useAgentsStore((s) => s.load);

  const [included, setIncluded] = useState<OrgPlanFilter>(() => ({
    includedRoleIndexes: new Set(plan.roles.map((r) => r.index)),
    includedAgentIndexes: new Set(plan.agents.map((a) => a.index)),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyOrgPlanResult | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const roleName = useMemo(() => {
    const m = new Map(plan.roles.map((r) => [r.index, r.name]));
    return (idx: number): string => m.get(idx) ?? `#${idx}`;
  }, [plan.roles]);

  const agentName = useMemo(() => {
    const m = new Map(plan.agents.map((a) => [a.index, a.name]));
    return (idx: number): string => m.get(idx) ?? `#${idx}`;
  }, [plan.agents]);

  const errors = useMemo(() => validateOrgPlanSelection(plan, included), [plan, included]);

  const toggleRole = (idx: number): void =>
    setIncluded((cur) => {
      const next = new Set(cur.includedRoleIndexes);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...cur, includedRoleIndexes: next };
    });

  const toggleAgent = (idx: number): void =>
    setIncluded((cur) => {
      const next = new Set(cur.includedAgentIndexes);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { ...cur, includedAgentIndexes: next };
    });

  const handleApprove = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const opts: { includeRoleIndexes?: number[]; includeAgentIndexes?: number[] } = {};
      if (included.includedRoleIndexes.size < plan.roles.length) {
        opts.includeRoleIndexes = [...included.includedRoleIndexes];
      }
      if (included.includedAgentIndexes.size < plan.agents.length) {
        opts.includeAgentIndexes = [...included.includedAgentIndexes];
      }
      const res = await approve(opts);
      setResult(res);
      if (!res.ok) setError(`${res.failedAtStep}: ${res.error}`);
      // The new agents are created in the main process; the renderer's agents
      // store doesn't observe that, so refresh it here — otherwise "Minha
      // equipe" keeps showing only the CEO until a full reload.
      else if (companyId !== null) await loadAgents(companyId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await reject(rejectReason.trim() === "" ? undefined : rejectReason.trim());
      setResult({ ok: true, createdRoleIds: [], hiredAgentIds: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (result !== null && result.ok) {
    return (
      <div className="bg-surface-card border border-surface-border rounded p-6 text-sm">
        <p className="font-semibold text-semantic-success">{t("orgPlan.applied.title")}</p>
        <p className="text-ink-muted mt-1">
          {t("orgPlan.applied.detail", {
            roles: result.createdRoleIds.length,
            agents: result.hiredAgentIds.length,
          })}
        </p>
        {result.hiredAgentIds.length > 0 && (
          <button
            type="button"
            onClick={() => navigate("/agents")}
            className="mt-4 px-4 py-2 bg-brand text-brand-fg rounded font-semibold"
          >
            {t("orgPlan.applied.viewTeam")}
          </button>
        )}
      </div>
    );
  }

  const approveDisabled = submitting || errors.length > 0;
  const timeAgo = timeAgoLabel(plan.proposedAt);

  const roleItems: AccordionItem[] = plan.roles.map((r) => ({
    id: String(r.index),
    avatar: { variant: "role" as const, label: r.name.slice(0, 2).toUpperCase() },
    name: r.name,
    sub: `${r.model} · ${r.description.slice(0, 60)}${r.description.length > 60 ? "…" : ""}`,
    badges: included.includedRoleIndexes.has(r.index)
      ? []
      : [{ label: t("orgPlan.excluded"), tone: "low" as const }],
    body: (
      <div className="pt-3 space-y-2">
        <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={included.includedRoleIndexes.has(r.index)}
            onChange={() => toggleRole(r.index)}
            className="w-4 h-4"
          />
          {t("orgPlan.includeRole")}
        </label>
        <p className="text-xs text-ink-muted">{r.description}</p>
        {r.charter !== "" && (
          <pre className="p-2 bg-surface-soft rounded text-[11px] whitespace-pre-wrap font-mono">
            {r.charter}
          </pre>
        )}
      </div>
    ),
  }));

  const agentItems: AccordionItem[] = plan.agents.map((a) => ({
    id: `agent-${String(a.index)}`,
    avatar: { variant: "person" as const, label: a.name.slice(0, 2).toUpperCase() },
    name: a.name,
    sub: `${roleName(a.roleIndex)} · ${t("orgPlan.reportsTo")} ${a.reportsToIndex === "CEO" ? "CEO" : agentName(a.reportsToIndex)}`,
    badges: included.includedAgentIndexes.has(a.index)
      ? []
      : [{ label: t("orgPlan.excluded"), tone: "low" as const }],
    body: (
      <div className="pt-3 space-y-2">
        <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={included.includedAgentIndexes.has(a.index)}
            onChange={() => toggleAgent(a.index)}
            className="w-4 h-4"
          />
          {t("orgPlan.includeAgent")}
        </label>
        <p className="text-xs text-ink-muted">{a.rationale}</p>
      </div>
    ),
  }));

  return (
    <DecisionPage
      header={
        <DecisionHeader
          chip={{ variant: "brand", label: t("decision.orgPlan.chip") }}
          meta={t("decision.orgPlan.meta", { author: "CEO", when: timeAgo })}
          title={plan.summary}
        />
      }
      hero={
        <HeroSummary
          variant="brand"
          stats={[
            {
              label: t("decision.orgPlan.stats.roles"),
              value: String(plan.roles.length),
            },
            {
              label: t("decision.orgPlan.stats.toHire"),
              value: String(plan.agents.length),
            },
          ]}
        />
      }
      sections={[
        errors.length > 0 ? (
          <section key="errors">
            <ul className="text-xs text-semantic-danger space-y-1 bg-semantic-danger-bg/30 border border-semantic-danger-bg rounded-md px-4 py-3">
              {errors.map((e, i) => (
                <li key={i}>
                  {e.kind === "agent-role-excluded"
                    ? t("orgPlan.validation.agentRoleExcluded", {
                        agent: agentName(e.agentIndex),
                        role: roleName(e.roleIndex),
                      })
                    : t("orgPlan.validation.agentReportsToExcluded", {
                        agent: agentName(e.agentIndex),
                        parent: agentName(e.reportsToIndex),
                      })}
                </li>
              ))}
            </ul>
          </section>
        ) : null,
        <section key="roles">
          <header className="mb-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
              {t("decision.orgPlan.rolesHeading", { count: plan.roles.length })}
            </h3>
          </header>
          <ItemAccordion items={roleItems} />
        </section>,
        <section key="agents">
          <header className="mb-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
              {t("orgPlan.agents", { count: plan.agents.length })}
            </h3>
          </header>
          <ItemAccordion items={agentItems} />
        </section>,
        showReject ? (
          <section key="reject-form" className="space-y-2">
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              placeholder={t("orgPlan.rejectReasonPlaceholder")}
              className="w-full px-2 py-1.5 border border-surface-border rounded bg-surface text-xs"
            />
            <button
              type="button"
              onClick={() => void handleReject()}
              disabled={submitting}
              className="text-xs px-3 py-1.5 bg-semantic-danger text-white rounded font-semibold disabled:opacity-50"
            >
              {t("orgPlan.confirmReject")}
            </button>
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
          onApprove={() => void handleApprove()}
          onReject={() => setShowReject((v) => !v)}
          approveLabel={submitting ? t("orgPlan.approving") : t("decision.shared.approve")}
          rejectLabel={t("decision.shared.reject")}
          disabled={approveDisabled}
        />
      }
    />
  );
};
