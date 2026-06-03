import { useState, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { InboxItem, InboxKind } from "@prospero/shared";
import { useInboxStore } from "../stores/inbox.js";
import { useCompaniesStore } from "../stores/companies.js";
import { SkillPromotionModal } from "../components/inbox/SkillPromotionModal.js";
import { SkillConsolidationModal } from "../components/inbox/SkillConsolidationModal.js";
import { TrustPromotionCard } from "../components/inbox/TrustPromotionCard.js";
import { ApprovalDecisionModal } from "../components/inbox/ApprovalDecisionModal.js";
import { InboxKindIcon } from "../components/inbox/inbox-kind-icon.js";
import { RiskPill } from "../components/ui/RiskPill.js";
import { inboxRisk } from "../lib/inbox-risk.js";

const GOAL_KINDS: InboxKind[] = [
  "goal_proposed",
  "goal_executing",
  "goal_error",
  "goal_retrospective_ready",
];

const extractGoalId = (payloadJson: string | null): string | null => {
  if (payloadJson === null) return null;
  try {
    const parsed = JSON.parse(payloadJson) as { goalId?: unknown };
    return typeof parsed.goalId === "string" ? parsed.goalId : null;
  } catch {
    return null;
  }
};

const extractSkillId = (payloadJson: string | null): string | null => {
  if (payloadJson === null) return null;
  try {
    const p = JSON.parse(payloadJson) as { skillId?: unknown };
    return typeof p.skillId === "string" ? p.skillId : null;
  } catch {
    return null;
  }
};

const extractProposalId = (payloadJson: string | null): string | null => {
  if (payloadJson === null) return null;
  try {
    const p = JSON.parse(payloadJson) as { proposalId?: unknown };
    return typeof p.proposalId === "string" ? p.proposalId : null;
  } catch {
    return null;
  }
};

const KIND_BORDER: Record<InboxKind, string> = {
  approval: "border-l-4 border-l-semantic-warning",
  completed: "border-l-4 border-l-semantic-success",
  suggestion: "border-l-4 border-l-brand",
  error: "border-l-4 border-l-semantic-danger",
  security_alert: "border-l-4 border-l-semantic-danger bg-semantic-danger/5",
  goal_proposed: "border-l-4 border-l-brand",
  goal_executing: "border-l-4 border-l-semantic-success",
  goal_error: "border-l-4 border-l-semantic-danger",
  agent_unresponsive: "border-l-4 border-l-semantic-danger",
  skill_candidate_pending: "border-l-4 border-l-brand",
  skill_promotion_requested: "border-l-4 border-l-brand",
  goal_retrospective_ready: "border-l-4 border-l-brand",
  memory_review_needed: "border-l-4 border-l-brand",
  org_proposed: "border-l-4 border-l-brand",
  budget_warning: "border-l-4 border-l-semantic-warning",
  verification_failed: "border-l-4 border-l-semantic-danger",
  verification_review: "border-l-4 border-l-semantic-warning",
  security_zone_blocked: "border-l-4 border-l-semantic-danger bg-semantic-danger/5",
  trust_promotion_suggested: "border-l-4 border-l-brand",
  auto_mode_expired: "border-l-4 border-l-semantic-warning",
  manager_request: "border-l-4 border-l-brand",
  ceo_decision: "border-l-4 border-l-semantic-success",
  skill_consolidation_proposed: "border-l-4 border-l-brand",
  business_proposed: "border-l-4 border-l-brand",
  sale: "border-l-4 border-l-semantic-success",
};

export const Inbox: FC = () => {
  const { t } = useTranslation();
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const [tab, setTab] = useState<"pendentes" | "historico">("pendentes");
  const [promotionSkillId, setPromotionSkillId] = useState<string | null>(null);
  const [consolidationProposalId, setConsolidationProposalId] = useState<string | null>(null);
  const [approvalModalItem, setApprovalModalItem] = useState<InboxItem | null>(null);

  const pending = items.filter((i) => i.readAt === null);
  const history = items.filter((i) => i.readAt !== null);
  const shown = tab === "pendentes" ? pending : history;

  return (
    <div className="px-8 py-7 mx-auto max-w-2xl">
      <h1 className="text-[25px] font-semibold tracking-[-0.025em] text-ink mb-1">
        {t("inbox.title")}
      </h1>
      <p className="text-[13px] text-ink-muted mb-5">{t("inbox.subtitle")}</p>
      <div className="flex gap-5 border-b border-surface-border mb-4">
        {(["pendentes", "historico"] as const).map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`text-[13px] pb-2.5 ${tab === tb ? "text-brand font-semibold shadow-[inset_0_-2px_0_var(--c-primary)]" : "text-ink-muted"}`}
          >
            {t(`inbox.tabs.${tb}`)}
            {tb === "pendentes" && pending.length > 0 ? ` · ${pending.length}` : ""}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {t(tab === "pendentes" ? "inbox.pendentesEmpty" : "inbox.historicoEmpty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((item) => {
            const risk = inboxRisk(item);
            return (
              <li
                key={item.id}
                className={`bg-surface-card border border-surface-border rounded-2xl p-4 ${KIND_BORDER[item.kind]} ${item.readAt === null ? "" : "opacity-70"}`}
              >
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-lg bg-surface-soft text-ink-muted flex items-center justify-center flex-shrink-0">
                    <InboxKindIcon kind={item.kind} className="text-[17px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink truncate">{item.title}</h3>
                      {risk !== null && <RiskPill kind={risk} />}
                      <span className="ml-auto text-[10px] font-mono text-ink-soft whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {item.preview !== null && (
                      <p className="text-xs text-ink-muted mt-1 break-words">{item.preview}</p>
                    )}
                    {item.kind === "trust_promotion_suggested" && (
                      <TrustPromotionCard item={item} markRead={(id) => void markRead(id)} />
                    )}
                    {(item.kind === "approval" || item.kind === "manager_request") &&
                      item.requiresAction &&
                      item.readAt === null && (
                        <div className="flex gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => setApprovalModalItem(item)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-brand-fg"
                          >
                            {t("inbox.decide")}
                          </button>
                        </div>
                      )}
                    {GOAL_KINDS.includes(item.kind) &&
                      (() => {
                        const goalId = extractGoalId(item.payloadJson);
                        if (goalId === null) return null;
                        return (
                          <Link
                            to={`/goals/${goalId}`}
                            onClick={() => {
                              if (item.readAt === null) void markRead(item.id);
                            }}
                            className="text-xs text-brand hover:underline font-semibold mt-2 inline-block"
                          >
                            {t("inbox.openGoal")} →
                          </Link>
                        );
                      })()}
                    {item.kind === "org_proposed" && (
                      <Link
                        to="/org-plan"
                        onClick={() => {
                          if (item.readAt === null) void markRead(item.id);
                        }}
                        className="text-xs text-brand hover:underline font-semibold mt-2 inline-block"
                      >
                        {t("inbox.openOrgPlan")} →
                      </Link>
                    )}
                    {item.kind === "goal_error" &&
                      (() => {
                        const goalId = extractGoalId(item.payloadJson);
                        if (goalId === null || item.payloadJson === null) return null;
                        let parsed: { step?: string } = {};
                        try {
                          parsed = JSON.parse(item.payloadJson) as { step?: string };
                        } catch {
                          return null;
                        }
                        if (parsed.step !== "narrated_halted") return null;
                        return (
                          <div className="flex gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => {
                                void window.prospero.goals
                                  .narratedResume({ goalId })
                                  .then(() => markRead(item.id));
                              }}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-brand-fg"
                            >
                              {t("inbox.goalError.recovery.resumeNarrated")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void window.prospero.goals
                                  .narratedRollback({ goalId })
                                  .then(() => markRead(item.id));
                              }}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-semantic-danger text-white"
                            >
                              {t("inbox.goalError.recovery.rollback")}
                            </button>
                          </div>
                        );
                      })()}
                    {item.kind === "skill_promotion_requested" &&
                      item.readAt === null &&
                      (() => {
                        const sid = extractSkillId(item.payloadJson);
                        if (sid === null) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => setPromotionSkillId(sid)}
                            className="mt-2 text-xs text-brand hover:underline font-semibold inline-block"
                          >
                            {t("inbox.skillPromotion.review")}
                          </button>
                        );
                      })()}
                    {item.kind === "skill_consolidation_proposed" &&
                      item.readAt === null &&
                      (() => {
                        const pid = extractProposalId(item.payloadJson);
                        if (pid === null) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => setConsolidationProposalId(pid)}
                            className="mt-2 text-xs text-brand hover:underline font-semibold inline-block"
                          >
                            {t("inbox.skillConsolidation.review")}
                          </button>
                        );
                      })()}
                    {item.kind === "skill_candidate_pending" &&
                      item.readAt === null &&
                      item.actorId !== null && (
                        // #9 (audit 2026-06-03): a learned-skill candidate had no
                        // action in the Inbox. Deep-link to the agent's Habilidades
                        // › Candidatos panel (accept/edit/dismiss live there).
                        <Link
                          to={`/agents/${item.actorId}/ajustar?tab=habilidades&sub=candidates`}
                          onClick={() => {
                            if (item.readAt === null) void markRead(item.id);
                          }}
                          className="text-xs text-brand hover:underline font-semibold mt-2 inline-block"
                        >
                          {t("inbox.skillCandidate.review")} →
                        </Link>
                      )}
                    {item.kind === "verification_failed" &&
                      (() => {
                        const goalId = extractGoalId(item.payloadJson);
                        if (goalId === null) return null;
                        return (
                          <Link
                            to={`/goals/${goalId}`}
                            onClick={() => {
                              if (item.readAt === null) void markRead(item.id);
                            }}
                            className="text-xs text-brand hover:underline font-semibold mt-2 inline-block"
                          >
                            {t("inbox.verificationFailed.open")} →
                          </Link>
                        );
                      })()}
                    {item.kind === "verification_review" &&
                      (() => {
                        const goalId = extractGoalId(item.payloadJson);
                        if (goalId === null) return null;
                        return (
                          <Link
                            to={`/goals/${goalId}`}
                            onClick={() => {
                              if (item.readAt === null) void markRead(item.id);
                            }}
                            className="text-xs text-brand hover:underline font-semibold mt-2 inline-block"
                          >
                            {t("inbox.verificationReview.open")} →
                          </Link>
                        );
                      })()}
                    {item.kind === "security_zone_blocked" && (
                      <p className="text-xs text-ink-muted mt-2">
                        {t("inbox.zoneBlocked.description")}
                      </p>
                    )}
                    {item.readAt === null && item.requiresAction === false && (
                      <button
                        onClick={() => void markRead(item.id)}
                        type="button"
                        className="text-[10px] text-ink-muted hover:underline mt-2"
                      >
                        {t("inbox.markRead")}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {promotionSkillId !== null && (
        <SkillPromotionModal
          skillId={promotionSkillId}
          onClose={() => setPromotionSkillId(null)}
          onApproved={() => {
            setPromotionSkillId(null);
            const companyId = useCompaniesStore.getState().activeId;
            if (companyId !== null) void useInboxStore.getState().load(companyId);
          }}
        />
      )}
      {consolidationProposalId !== null &&
        (() => {
          const companyId = useCompaniesStore.getState().activeId;
          if (companyId === null) return null;
          return (
            <SkillConsolidationModal
              proposalId={consolidationProposalId}
              companyId={companyId}
              onClose={() => setConsolidationProposalId(null)}
              onResolved={() => {
                setConsolidationProposalId(null);
                void useInboxStore.getState().load(companyId);
              }}
            />
          );
        })()}
      {approvalModalItem !== null && (
        <ApprovalDecisionModal
          item={approvalModalItem}
          open={approvalModalItem !== null}
          onClose={() => setApprovalModalItem(null)}
          onDecided={() => void markRead(approvalModalItem.id)}
        />
      )}
    </div>
  );
};
