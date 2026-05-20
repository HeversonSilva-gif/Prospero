import type { FC, ReactNode } from "react";

// M16 PR-B1 — stat card for the "O que aconteceu esta noite" section.
// Horizontal layout: rounded icon container + value (large) + label (small).

type Props = {
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
  value: string;
  label: string;
};

export const StatCard: FC<Props> = ({ icon, iconBg, iconColor, value, label }) => (
  <div className="flex-1 flex items-center gap-3 bg-surface-card border border-surface-border rounded-lg px-4 py-3">
    <span
      className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${iconBg} ${iconColor}`}
      aria-hidden="true"
    >
      {icon}
    </span>
    <div className="min-w-0">
      <div className="text-base font-bold text-ink leading-tight">{value}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  </div>
);
