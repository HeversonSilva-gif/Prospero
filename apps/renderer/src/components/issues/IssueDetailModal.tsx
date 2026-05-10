import type { FC } from "react";

type Props = { issueId: string; onClose: () => void };

// PLACEHOLDER — full implementation in Task 22.
export const IssueDetailModal: FC<Props> = ({ issueId, onClose }) => (
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    onClick={onClose}
  >
    <div
      className="bg-surface-card rounded p-6 w-full max-w-2xl shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-ink-muted text-sm">Issue {issueId} detail — landing in Task 22.</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 text-xs px-3 py-1 bg-brand text-white rounded"
      >
        Close
      </button>
    </div>
  </div>
);
