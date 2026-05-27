import { useState, useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import ReactDiffViewer from "react-diff-viewer-continued";
import type { IssueArtifact, IssueCriterionResult } from "@prospero/shared";
import { useIssuesStore } from "../../stores/issues.js";
import { useSettingsStore } from "../../stores/settings.js";
import {
  type ReviewDecision,
  statusForDecision,
  validateDecision,
} from "../../lib/issue-review/decision.js";
import { pickDiffArtifact } from "../../lib/issue-review/artifact.js";
import {
  DecisionPage,
  DecisionHeader,
  HeroSummary,
  DecisionActions,
  IssueCriteriaVerified,
  type CriterionResult,
} from "../decision/index.js";

type Props = {
  issueId: string;
  artifacts: readonly IssueArtifact[];
};

// Map an IssueCriterionResult (DB shape) to the CriterionResult prop expected
// by IssueCriteriaVerified.
const toVerifyResult = (r: IssueCriterionResult): CriterionResult => {
  if (r.status === "pass") return { id: r.id, text: r.text, result: "pass" };
  if (r.status === "fail") return { id: r.id, text: r.text, result: "fail" };
  // pending: distinguish auto (deterministic) vs human (judgment)
  return {
    id: r.id,
    text: r.text,
    result: r.kind === "judgment" ? "pending-human" : "pending-auto",
  };
};

export const IssueReviewBlock: FC<Props> = ({ issueId, artifacts }) => {
  const { t } = useTranslation();
  const update = useIssuesStore((s) => s.update);
  const addComment = useIssuesStore((s) => s.addComment);
  const detail = useIssuesStore((s) => s.detail);
  const theme = useSettingsStore((s) => s.settings.theme);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<"comment_required" | null>(null);
  const [criteriaResults, setCriteriaResults] = useState<IssueCriterionResult[]>([]);

  useEffect(() => {
    void window.prospero.issues.listCriteriaResults(issueId).then(setCriteriaResults);
  }, [issueId]);

  const verifiedCriteria = criteriaResults.map(toVerifyResult);
  const passedCount = criteriaResults.filter((r) => r.status === "pass").length;
  const humanPendingCount = criteriaResults.filter(
    (r) => r.status === "pending" && r.kind === "judgment",
  ).length;
  const totalCount = criteriaResults.length;
  const hasCriteria = totalCount > 0;

  const diffArtifact = pickDiffArtifact(artifacts);
  const deliveredByName = detail?.assignee?.name ?? "—";

  const decide = async (decision: ReviewDecision): Promise<void> => {
    const trimmed = comment.trim();
    const result = validateDecision(decision, trimmed);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    setBusy(decision);
    try {
      await update({ id: issueId, status: statusForDecision(decision) });
      if (trimmed !== "") {
        await addComment(issueId, trimmed);
      }
      setComment("");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="issue-review-block">
      <DecisionPage
        compact
        header={
          <DecisionHeader
            chip={{ variant: "review", label: t("decision.issueReview.chip") }}
            meta={t("decision.issueReview.meta", { author: deliveredByName })}
            title={detail?.issue.title ?? ""}
            compact
          />
        }
        hero={
          <HeroSummary
            variant="review"
            stats={[
              {
                label: t("decision.issueReview.stats.deliveredBy"),
                value: deliveredByName,
              },
              {
                label: t("decision.issueReview.stats.criteria"),
                value: hasCriteria ? `${passedCount} / ${totalCount}` : "—",
                sub: hasCriteria
                  ? t("decision.issueReview.stats.criteriaSub", {
                      passed: passedCount,
                      awaiting: humanPendingCount,
                    })
                  : t("decision.issueReview.stats.criteriaNa"),
              },
            ]}
          />
        }
        sections={[
          ...(hasCriteria
            ? [
                <section key="criteria">
                  <header className="mb-3">
                    <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
                      {t("decision.issueReview.criteriaHeading")}
                    </h3>
                  </header>
                  <IssueCriteriaVerified criteria={verifiedCriteria} />
                </section>,
              ]
            : []),

          <section key="diff">
            <header className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
                {t("decision.issueReview.deliveredHeading")}
              </h3>
              {diffArtifact !== null && (
                <span className="text-[10px] text-ink-soft font-mono">
                  {t(`issues.detail.artifacts.kind.${diffArtifact.kind}`)} · {diffArtifact.ref}
                </span>
              )}
            </header>
            {diffArtifact === null ? (
              <p className="text-xs text-ink-soft">{t("issues.review.empty")}</p>
            ) : (
              <div className="text-[11px] border border-surface-border rounded overflow-hidden">
                <ReactDiffViewer
                  oldValue=""
                  newValue={diffArtifact.contentPreview ?? ""}
                  splitView={true}
                  useDarkTheme={theme === "dark"}
                  leftTitle={t("issues.review.diffOld")}
                  rightTitle={t("issues.review.diffNew")}
                  hideLineNumbers={false}
                />
              </div>
            )}
          </section>,

          <section key="comment">
            <header className="mb-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink m-0">
                {t("decision.issueReview.commentHeading")}
              </h3>
            </header>
            <textarea
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                if (error !== null) setError(null);
              }}
              rows={2}
              placeholder={t("issues.review.commentPlaceholder")}
              className="w-full px-2 py-1 border border-surface-border rounded text-xs bg-surface-card"
            />
            {error === "comment_required" && (
              <p className="text-[11px] text-semantic-danger mt-1">
                {t("issues.review.commentRequired")}
              </p>
            )}
          </section>,
        ]}
        actions={
          <DecisionActions
            estimates={[{ label: t("decision.issueReview.turnCost"), value: "—" }]}
            onApprove={() => void decide("approve")}
            onRequestChanges={() => void decide("request_changes")}
            onReject={() => void decide("reject")}
            approveLabel={busy === "approve" ? "…" : t("decision.issueReview.approveLabel")}
            requestChangesLabel={
              busy === "request_changes" ? "…" : t("decision.shared.requestChanges")
            }
            rejectLabel={busy === "reject" ? "…" : t("decision.shared.reject")}
            disabled={busy !== null}
          />
        }
      />
    </div>
  );
};
