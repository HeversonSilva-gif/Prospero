type Estimate = { label: string; value: string };

type Props = {
  estimates?: Estimate[];
  onApprove: () => void;
  onRequestChanges?: () => void;
  onReject: () => void;
  approveLabel?: string;
  requestChangesLabel?: string;
  rejectLabel?: string;
  disabled?: boolean;
};

export const DecisionActions = ({
  estimates,
  onApprove,
  onRequestChanges,
  onReject,
  approveLabel = "Aprovar e executar",
  requestChangesLabel = "Pedir mudanças",
  rejectLabel = "Rejeitar",
  disabled = false,
}: Props): JSX.Element => (
  <div className="sticky bottom-0 bg-surface/95 backdrop-blur border-t border-surface-border px-9 py-4 flex items-center justify-between gap-4 z-10">
    <div className="flex gap-7">
      {(estimates ?? []).map((e) => (
        <div key={e.label}>
          <p className="text-[10px] uppercase tracking-wider text-ink-soft font-semibold m-0 mb-0.5">
            {e.label}
          </p>
          <p className="text-sm font-semibold text-ink m-0">{e.value}</p>
        </div>
      ))}
    </div>
    <div className="flex gap-2.5">
      <button
        type="button"
        onClick={onReject}
        disabled={disabled}
        className="bg-transparent text-semantic-danger px-4 py-2 rounded-md font-semibold text-[13px] hover:bg-semantic-danger-bg disabled:opacity-50"
      >
        {rejectLabel}
      </button>
      {onRequestChanges !== undefined && (
        <button
          type="button"
          onClick={onRequestChanges}
          disabled={disabled}
          className="bg-surface-soft text-ink border border-surface-border px-4 py-2 rounded-md font-semibold text-[13px] hover:border-ink-soft disabled:opacity-50"
        >
          {requestChangesLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled}
        className="bg-brand text-white px-5 py-2.5 rounded-md font-semibold text-sm hover:bg-brand-dark disabled:opacity-50"
      >
        {approveLabel}
      </button>
    </div>
  </div>
);
