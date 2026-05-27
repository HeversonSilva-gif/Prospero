import type { ReactNode } from "react";

export type ChipVariant = "brand" | "goal" | "review" | "good" | "warn" | "bad";

const variantClasses: Record<ChipVariant, string> = {
  brand: "bg-brand-bg text-brand",
  goal: "bg-semantic-warning-bg text-semantic-warning",
  review: "bg-semantic-info-bg text-semantic-info",
  good: "bg-semantic-success-bg text-semantic-success",
  warn: "bg-semantic-warning-bg text-semantic-warning",
  bad: "bg-semantic-danger-bg text-semantic-danger",
};

type Props = { variant: ChipVariant; children: ReactNode };

export const Chip = ({ variant, children }: Props): JSX.Element => (
  <span
    className={`inline-block text-[10px] uppercase tracking-wide rounded px-2.5 py-1 font-semibold leading-none ${variantClasses[variant]}`}
  >
    {children}
  </span>
);
