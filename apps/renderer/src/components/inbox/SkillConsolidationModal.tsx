import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { SkillProposal } from "@prospero/shared";

interface Props {
  proposalId: string;
  companyId: string;
  onClose: () => void;
  onResolved: () => void;
}

// Reviews a pending skill-consolidation proposal: shows rationale, kind, and
// the proposed body (editable for merge/patch). User can approve or reject.
export const SkillConsolidationModal: FC<Props> = ({
  proposalId,
  companyId,
  onClose,
  onResolved,
}) => {
  const { t } = useTranslation();
  const [proposal, setProposal] = useState<SkillProposal | null>(null);
  const [editedBody, setEditedBody] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const proposals = await window.prospero.learning.listProposals(companyId);
        const found = proposals.find((p) => p.id === proposalId);
        if (found === undefined) {
          onClose();
          return;
        }
        setProposal(found);
        setEditedBody(found.proposedBody ?? "");
      } catch {
        onClose();
      }
    })();
  }, [proposalId, companyId, onClose]);

  const approve = (): void => {
    if (proposal === null) return;
    setBusy(true);
    void (async () => {
      try {
        if (proposal.kind === "archive") {
          await window.prospero.learning.acceptProposal({ proposalId });
        } else {
          await window.prospero.learning.acceptProposal({ proposalId, body: editedBody });
        }
        onResolved();
      } finally {
        setBusy(false);
      }
    })();
  };

  const reject = (): void => {
    if (proposal === null) return;
    setBusy(true);
    void (async () => {
      try {
        await window.prospero.learning.rejectProposal({ proposalId });
        onResolved();
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface border border-surface-border rounded-lg w-[32rem] max-w-[90vw] p-5">
        <h2 className="text-sm font-semibold text-ink mb-3">
          {t("inbox.skillConsolidation.title")}
        </h2>
        {proposal === null ? (
          <p className="text-xs text-ink-muted">…</p>
        ) : (
          <>
            <p className="text-xs text-ink-muted mb-2">
              {t(`inbox.skillConsolidation.kind.${proposal.kind}`)}
              {proposal.kind === "merge" && (
                <span className="ml-2">
                  —{" "}
                  {t("inbox.skillConsolidation.combines", {
                    count: proposal.sourceSkillIds.length,
                  })}
                </span>
              )}
            </p>
            {(proposal.proposedName !== null || proposal.proposedDescription !== null) && (
              <div className="mb-3">
                {proposal.proposedName !== null && (
                  <p className="text-xs font-semibold text-ink">{proposal.proposedName}</p>
                )}
                {proposal.proposedDescription !== null && (
                  <p className="text-xs text-ink-muted mt-0.5">{proposal.proposedDescription}</p>
                )}
              </div>
            )}
            <label className="block text-xs text-ink-muted mb-1">
              {t("inbox.skillConsolidation.rationale")}
            </label>
            <pre className="text-xs text-ink-muted whitespace-pre-wrap font-mono max-h-32 overflow-auto bg-surface-soft rounded p-2.5 mb-3">
              {proposal.rationale}
            </pre>
            {(proposal.kind === "merge" || proposal.kind === "patch") && (
              <>
                <label className="block text-xs text-ink-muted mb-1">
                  {t("inbox.skillConsolidation.bodyLabel")}
                </label>
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={8}
                  className="w-full text-xs font-mono bg-surface-soft border border-surface-border rounded p-2.5 resize-y"
                />
              </>
            )}
          </>
        )}
        <div className="flex gap-2 mt-4 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded disabled:opacity-50"
          >
            {t("inbox.skillConsolidation.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || proposal === null}
            onClick={reject}
            className="text-xs px-3 py-1.5 bg-surface-soft text-semantic-danger rounded disabled:opacity-50"
          >
            {t("inbox.skillConsolidation.reject")}
          </button>
          <button
            type="button"
            disabled={busy || proposal === null}
            onClick={approve}
            className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded disabled:opacity-50"
          >
            {t("inbox.skillConsolidation.approve")}
          </button>
        </div>
      </div>
    </div>
  );
};
