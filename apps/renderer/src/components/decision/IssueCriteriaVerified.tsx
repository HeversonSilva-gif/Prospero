import type { FC } from "react";

export type VerifyResult = "pass" | "fail" | "pending-auto" | "pending-human";

export type CriterionResult = {
  id: string;
  text: string;
  result: VerifyResult;
};

type Props = {
  criteria: CriterionResult[];
};

const markClasses: Record<VerifyResult, string> = {
  pass: "bg-semantic-success-bg text-semantic-success",
  fail: "bg-semantic-danger-bg text-semantic-danger",
  "pending-auto": "bg-semantic-warning-bg text-semantic-warning",
  "pending-human": "bg-semantic-warning-bg text-semantic-warning",
};

const markSymbol: Record<VerifyResult, string> = {
  pass: "✓",
  fail: "✗",
  "pending-auto": "?",
  "pending-human": "?",
};

export const IssueCriteriaVerified: FC<Props> = ({ criteria }) => (
  <div className="space-y-1">
    {criteria.map((c) => (
      <div
        key={c.id}
        className="flex gap-3 items-center px-3.5 py-2.5 bg-surface-card border border-surface-border rounded-md"
      >
        <span
          className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-[13px] ${markClasses[c.result]}`}
        >
          {markSymbol[c.result]}
        </span>
        <span className="flex-1 text-[13px] text-ink">{c.text}</span>
        <span className="text-[10px] text-ink-soft uppercase tracking-wide">
          {c.result === "pending-human" ? "Você decide" : "Auto"}
        </span>
      </div>
    ))}
  </div>
);
