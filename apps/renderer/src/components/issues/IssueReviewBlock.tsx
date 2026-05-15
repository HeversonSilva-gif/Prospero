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

type Props = {
  issueId: string;
  artifacts: readonly IssueArtifact[];
};

export const IssueReviewBlock: FC<Props> = ({ issueId, artifacts }) => {
  const { t } = useTranslation();
  const update = useIssuesStore((s) => s.update);
  const addComment = useIssuesStore((s) => s.addComment);
  const theme = useSettingsStore((s) => s.settings.theme);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<"comment_required" | null>(null);

  const diffArtifact = pickDiffArtifact(artifacts);

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
    <section
      data-testid="issue-review-block"
      className="border border-semantic-warning/40 bg-semantic-warning/5 rounded p-3 mb-4"
    >
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-semantic-warning">
          {t("issues.review.heading")}
        </h3>
        {diffArtifact !== null && (
          <span className="text-[10px] text-ink-soft font-mono">
            {t(`issues.detail.artifacts.kind.${diffArtifact.kind}`)} · {diffArtifact.ref}
          </span>
        )}
      </header>

      {diffArtifact === null ? (
        <p className="text-xs text-ink-soft mb-3">{t("issues.review.empty")}</p>
      ) : (
        <div className="text-[11px] mb-3 border border-surface-border rounded overflow-hidden">
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

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => void decide("approve")}
          disabled={busy !== null}
          className="text-xs px-3 py-1 bg-semantic-success text-white rounded font-semibold disabled:opacity-50"
        >
          {busy === "approve" ? "…" : t("issues.review.approve")}
        </button>
        <button
          type="button"
          onClick={() => void decide("request_changes")}
          disabled={busy !== null}
          className="text-xs px-3 py-1 bg-surface-soft text-ink rounded font-semibold disabled:opacity-50"
        >
          {busy === "request_changes" ? "…" : t("issues.review.requestChanges")}
        </button>
        <button
          type="button"
          onClick={() => void decide("reject")}
          disabled={busy !== null}
          className="text-xs px-3 py-1 bg-semantic-danger text-white rounded font-semibold disabled:opacity-50 ml-auto"
        >
          {busy === "reject" ? "…" : t("issues.review.reject")}
        </button>
      </div>
    </section>
  );
};
