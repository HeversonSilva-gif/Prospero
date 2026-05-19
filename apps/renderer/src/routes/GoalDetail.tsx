import { useEffect, useState, type FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGoalsStore } from "../stores/goals.js";
import { GoalDetailHeader } from "../components/GoalDetailHeader.js";
import { GoalPlanReview } from "../components/GoalPlanReview.js";
import { GoalPlanHistory } from "../components/GoalPlanHistory.js";
import { IsaPanel } from "../components/IsaPanel.js";

type TabKey = "plan" | "isa" | "subgoals" | "issues" | "history";

const TABS: TabKey[] = ["plan", "isa", "subgoals", "issues", "history"];

export const GoalDetail: FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const detail = useGoalsStore((s) => s.detail);
  const loadDetail = useGoalsStore((s) => s.loadDetail);
  const clearDetail = useGoalsStore((s) => s.clearDetail);
  const requestPlan = useGoalsStore((s) => s.requestPlan);
  const [tab, setTab] = useState<TabKey>("plan");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id !== undefined) {
      void loadDetail(id);
    }
    return () => {
      clearDetail();
    };
  }, [id, loadDetail, clearDetail]);

  if (detail === null || detail.id !== id) {
    return (
      <div className="p-8 max-w-4xl">
        <p className="text-sm text-ink-muted">{t("goals.detail.loading")}</p>
      </div>
    );
  }

  const handleRequestPlan = async () => {
    setRequesting(true);
    setError(null);
    try {
      await requestPlan(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  };

  const canRequestPlan =
    detail.status === "draft" || (detail.status === "planning" && detail.currentPlan === null);

  return (
    <div className="p-8 max-w-4xl">
      <Link to="/goals" className="text-xs text-brand hover:underline mb-3 inline-block">
        ← {t("goals.detail.backToList")}
      </Link>

      <GoalDetailHeader goal={detail} />

      {canRequestPlan && (
        <div className="bg-surface-card rounded p-4 my-4 border border-surface-border">
          <p className="text-sm text-ink-muted mb-2">{t("goals.detail.noPlanYet")}</p>
          <button
            type="button"
            onClick={() => void handleRequestPlan()}
            disabled={requesting}
            className="px-3 py-1.5 bg-brand text-brand-fg text-sm rounded font-semibold disabled:opacity-50"
          >
            {requesting ? t("goals.detail.requestingPlan") : t("goals.detail.askCeoToPlan")}
          </button>
          {error !== null && <p className="text-sm text-semantic-danger mt-2">{error}</p>}
        </div>
      )}

      <div className="flex gap-1 border-b border-surface-border my-4">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              tab === k
                ? "border-brand text-brand font-semibold"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t(`goals.detail.tabs.${k}`)}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "plan" && (
          <>
            {detail.currentPlan !== null ? (
              <GoalPlanReview plan={detail.currentPlan} goal={detail} />
            ) : detail.status === "planning" ? (
              <p className="text-sm text-ink-muted bg-surface-soft rounded p-4">
                {t("goals.detail.planning")}
              </p>
            ) : (
              <p className="text-sm text-ink-muted bg-surface-soft rounded p-4">
                {t("goals.detail.noCurrentPlan")}
              </p>
            )}
          </>
        )}
        {tab === "isa" && <IsaPanel goalId={detail.id} />}
        {tab === "subgoals" && (
          <p className="text-sm text-ink-muted bg-surface-soft rounded p-4">
            {t("goals.detail.subgoalsPending")}
          </p>
        )}
        {tab === "issues" && (
          <p className="text-sm text-ink-muted bg-surface-soft rounded p-4">
            {t("goals.detail.issuesPending")}
          </p>
        )}
        {tab === "history" && <GoalPlanHistory plans={detail.history} />}
      </div>
    </div>
  );
};

export default GoalDetail;
