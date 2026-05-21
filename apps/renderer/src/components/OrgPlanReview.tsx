import { type FC, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ApplyOrgPlanResult, OrgPlan, ProposedAgent, ProposedRole } from "@prospero/shared";
import { useOrgPlanStore } from "../stores/orgPlan.js";
import { useAgentsStore } from "../stores/agents.js";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";
import { validateOrgPlanSelection, type OrgPlanFilter } from "../lib/orgPlanValidation.js";

const RoleRow: FC<{
  role: ProposedRole;
  included: boolean;
  onToggle: () => void;
}> = ({ role, included, onToggle }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <li
      className={`bg-surface-card border border-surface-border rounded p-3 ${included ? "" : "opacity-50"}`}
    >
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={included} onChange={onToggle} className="w-4 h-4" />
        {role.icon !== null && <span>{role.icon}</span>}
        <span className="text-sm font-semibold text-brand-dark">{role.name}</span>
        <span className="text-xs text-ink-muted">· {role.model}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-xs text-brand hover:underline"
        >
          {expanded ? t("orgPlan.collapse") : t("orgPlan.viewCharter")}
        </button>
      </div>
      <p className="text-xs text-ink-muted mt-1 pl-7">{role.description}</p>
      {expanded && (
        <pre className="mt-2 ml-7 p-2 bg-surface-soft rounded text-[11px] whitespace-pre-wrap font-mono">
          {role.charter}
        </pre>
      )}
    </li>
  );
};

const AgentRow: FC<{
  agent: ProposedAgent;
  roleName: string;
  reportsToLabel: string;
  included: boolean;
  onToggle: () => void;
}> = ({ agent, roleName, reportsToLabel, included, onToggle }) => {
  const { t } = useTranslation();
  return (
    <li
      className={`bg-surface-card border border-surface-border rounded p-3 ${included ? "" : "opacity-50"}`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <input type="checkbox" checked={included} onChange={onToggle} className="w-4 h-4" />
        <span className="text-sm font-semibold text-brand-dark">{agent.name}</span>
        <span className="text-xs text-ink-muted">· {roleName}</span>
        <span className="text-xs text-ink-muted">
          · {t("orgPlan.reportsTo")} {reportsToLabel}
        </span>
      </div>
      <p className="text-xs text-ink-muted mt-1 pl-7">{agent.rationale}</p>
    </li>
  );
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

  return (
    <div className="bg-surface-card border border-surface-border rounded">
      <section className="p-4 border-b border-surface-border">
        <h2 className="text-sm font-semibold text-brand-dark mb-2">{t("orgPlan.title")}</h2>
        <p className="text-sm text-ink whitespace-pre-wrap">{plan.summary}</p>
      </section>

      <section className="p-4 border-b border-surface-border">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-soft mb-2">
          {t("orgPlan.roles", { count: plan.roles.length })}
        </h3>
        <ul className="space-y-2">
          {plan.roles.map((r) => (
            <RoleRow
              key={r.index}
              role={r}
              included={included.includedRoleIndexes.has(r.index)}
              onToggle={() => toggleRole(r.index)}
            />
          ))}
        </ul>
      </section>

      <section className="p-4 border-b border-surface-border">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-soft mb-2">
          {t("orgPlan.agents", { count: plan.agents.length })}
        </h3>
        <ul className="space-y-2">
          {plan.agents.map((a) => (
            <AgentRow
              key={a.index}
              agent={a}
              roleName={roleName(a.roleIndex)}
              reportsToLabel={a.reportsToIndex === "CEO" ? "CEO" : agentName(a.reportsToIndex)}
              included={included.includedAgentIndexes.has(a.index)}
              onToggle={() => toggleAgent(a.index)}
            />
          ))}
        </ul>
      </section>

      {errors.length > 0 && (
        <section className="p-4 border-b border-surface-border bg-semantic-danger/5">
          <ul className="text-xs text-semantic-danger space-y-1">
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
      )}

      <div className="p-4 flex gap-3 flex-wrap items-start">
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={approveDisabled}
          className="px-4 py-2 bg-semantic-success text-white text-sm rounded font-semibold disabled:opacity-50"
        >
          {submitting ? t("orgPlan.approving") : t("orgPlan.approve")}
        </button>
        <button
          type="button"
          onClick={() => setShowReject((v) => !v)}
          disabled={submitting}
          className="px-4 py-2 bg-semantic-danger text-white text-sm rounded font-semibold disabled:opacity-50"
        >
          {t("orgPlan.reject")}
        </button>
        {error !== null && <p className="basis-full text-sm text-semantic-danger">{error}</p>}
        {showReject && (
          <div className="basis-full mt-2 space-y-2">
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
          </div>
        )}
      </div>
    </div>
  );
};
