import type { FC } from "react";

type Props = { companyId: string; parentId?: string; onClose: () => void };

// PLACEHOLDER — full implementation in Task 21.
export const IssueFormModal: FC<Props> = ({ onClose }) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-surface-card rounded p-5 w-full max-w-sm shadow-xl">
      <p className="text-ink-muted text-sm">Issue form — landing in Task 21.</p>
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
