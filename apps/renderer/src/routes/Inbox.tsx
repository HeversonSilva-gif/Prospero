import { useState, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { InboxItem, InboxKind } from "@prospero/shared";
import { useInboxStore } from "../stores/inbox.js";
import { useCompaniesStore } from "../stores/companies.js";
import { SkillPromotionModal } from "../components/inbox/SkillPromotionModal.js";
import { TrustPromotionCard } from "../components/inbox/TrustPromotionCard.js";
import { ApprovalDecisionModal } from "../components/inbox/ApprovalDecisionModal.js";

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
};

type FilterKey = "all" | InboxKind;

const FILTERS: FilterKey[] = [
  "all",
  "approval",
  "completed",
  "suggestion",
  "error",
  "security_alert",
  "security_zone_blocked",
  "goal_proposed",
  "goal_executing",
  "goal_error",
  "manager_request",
  "ceo_decision",
];

export const Inbox: FC = () => {
  const { t } = useTranslation();
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [promotionSkillId, setPromotionSkillId] = useState<string | null>(null);
  const [approvalModalItem, setApprovalModalItem] = useState<InboxItem | null>(null);

  const filtered = filter === "all" ? items : items.filter((i) => i.kind === filter);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-4">{t("inbox.title")}</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            type="button"
            className={`text-xs px-2 py-1 rounded ${filter === f ? "bg-brand text-brand-fg" : "bg-surface-soft text-ink-muted"}`}
          >
            {t(`inbox.filter.${f}`)}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="text-ink-muted text-sm">{t("inbox.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li
              key={item.id}
              className={`bg-surface-card rounded p-3 ${KIND_BORDER[item.kind]} ${item.readAt === null ? "" : "opacity-60"}`}
            >
              <div className="flex justify-between gap-3">
                <h3 className="text-sm font-semibold text-brand-dark">{item.title}</h3>
                <span className="text-[10px] text-ink-soft">
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
                      className="text-xs px-3 py-1 bg-brand text-brand-fg rounded font-semibold"
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
                        className="text-xs px-3 py-1 bg-brand text-brand-fg rounded font-semibold"
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
                        className="text-xs px-3 py-1 bg-semantic-danger text-white rounded font-semibold"
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
                      className="mt-2 text-xs text-brand hover:underline"
                    >
                      {t("inbox.skillPromotion.review")}
                    </button>
                  );
                })()}
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
                <p className="text-xs text-ink-muted mt-2">{t("inbox.zoneBlocked.description")}</p>
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
            </li>
          ))}
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
