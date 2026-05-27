import type { FC } from "react";

export type CriterionEntry = {
  id: string;
  kind: "auto" | "human";
  text: string;
  rule?: string;
  note?: string;
};

type Props = {
  criteria: CriterionEntry[];
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  addLabel?: string;
  editLabel?: string;
  removeLabel?: string;
  autoPillLabel?: string;
  humanPillLabel?: string;
};

export const IsaCriteriaEditor: FC<Props> = ({
  criteria,
  onEdit,
  onRemove,
  onAdd,
  addLabel = "Adicionar critério",
  editLabel = "Editar",
  removeLabel = "Remover",
  autoPillLabel = "Auto",
  humanPillLabel = "Revisão humana",
}) => (
  <div className="bg-surface-card border border-surface-border rounded-lg overflow-hidden">
    {criteria.map((c) => (
      <div
        key={c.id}
        className="group flex gap-3.5 items-start px-4 py-3.5 border-b border-surface-border last:border-b-0"
      >
        {/* kind icon */}
        <span
          className={`w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center font-bold text-[13px] ${
            c.kind === "auto"
              ? "bg-semantic-success-bg text-semantic-success"
              : "bg-semantic-warning-bg text-semantic-warning"
          }`}
        >
          {c.kind === "auto" ? "A" : "H"}
        </span>

        {/* body */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ink leading-normal mb-1.5">{c.text}</p>
          <div className="flex gap-2.5 items-center text-[11px] text-ink-soft flex-wrap">
            {/* kind pill */}
            <span
              className={`px-2 py-0.5 rounded-sm font-semibold uppercase tracking-wide text-[10px] ${
                c.kind === "auto"
                  ? "bg-semantic-success-bg text-semantic-success"
                  : "bg-semantic-warning-bg text-semantic-warning"
              }`}
            >
              {c.kind === "auto" ? autoPillLabel : humanPillLabel}
            </span>
            {/* code chip for auto */}
            {c.kind === "auto" && c.rule !== undefined && c.rule !== "" && (
              <code className="bg-surface px-1.5 py-0.5 rounded text-[11px] font-mono text-ink-muted border border-surface-border">
                {c.rule}
              </code>
            )}
            {/* note for human */}
            {c.kind === "human" && c.note !== undefined && c.note !== "" && <span>{c.note}</span>}
          </div>
        </div>

        {/* actions */}
        <div className="flex gap-1.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onEdit(c.id)}
            className="bg-transparent text-ink-soft text-[11px] px-2 py-1 rounded font-[inherit] hover:bg-surface-soft hover:text-ink"
          >
            {editLabel}
          </button>
          <button
            type="button"
            onClick={() => onRemove(c.id)}
            className="bg-transparent text-ink-soft text-[11px] px-2 py-1 rounded font-[inherit] hover:bg-surface-soft hover:text-semantic-danger"
          >
            {removeLabel}
          </button>
        </div>
      </div>
    ))}

    {/* add row */}
    <div
      role="button"
      tabIndex={0}
      onClick={onAdd}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onAdd();
      }}
      className="flex items-center gap-2.5 px-4 py-3 border-t border-surface-border bg-brand-bg/40 cursor-pointer hover:bg-brand-bg/70 transition-colors"
    >
      <span className="w-6 h-6 rounded-md bg-brand-bg text-brand flex items-center justify-center font-bold text-sm flex-shrink-0">
        +
      </span>
      <span className="text-sm text-brand font-medium">{addLabel}</span>
    </div>
  </div>
);
