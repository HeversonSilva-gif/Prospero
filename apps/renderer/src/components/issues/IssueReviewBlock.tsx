import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import ReactDiffViewer from "react-diff-viewer-continued";
import type { IssueArtifact } from "@prospero/shared";
import { useIssuesStore } from "../../stores/issues.js";
import { useSettingsStore } from "../../stores/settings.js";
import {
  type ReviewDecision,
  statusForDecision,
  validateDecision,
} from "../../lib/issue-review/decision.js";
import { pickDiffArtifact } from "../../lib/issue-review/artifact.js";
import { DecisionPage, DecisionHeader, HeroSummary, DecisionActions } from "../decision/index.js";

type Props = {
  issueId: string;
  artifacts: readonly IssueArtifact[];
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
                // TODO(decision): criteria results not yet available from renderer;
                // needs backend IPC exposing listCriteriaForIssue + criterion statuses.
                value: "—",
                sub: t("decision.issueReview.stats.criteriaNa"),
              },
            ]}
          />
        }
        sections={[
          // TODO(decision): IssueCriteriaVerified section — blocked on renderer-side
          // IPC for issue criteria results (Issue type has no goalId; no
          // window.prospero.isa.listCriteriaForIssue IPC exists yet).
          // Once backend exposes IPC, replace this placeholder with:
          //   <IssueCriteriaVerified criteria={criteriaResults} />

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
