import type { FC, ReactNode } from "react";
import { Link } from "react-router-dom";

// M16 PR-B2 — tile reusável da grade Ajustes.
// Layout: círculo (icon) + título + sub-texto. Clicável (toda a tile é um Link).

type Props = {
  to: string;
  icon: ReactNode;
  title: string;
  sub: string;
};

export const AjustesCard: FC<Props> = ({ to, icon, title, sub }) => (
  <Link
    to={to}
    className="flex flex-col items-start gap-3 bg-surface-card border border-surface-border rounded-xl p-5 hover:border-brand hover:bg-surface-soft transition-colors"
  >
    <span
      className="w-10 h-10 rounded-full flex items-center justify-center bg-brand-bg text-brand flex-shrink-0"
      aria-hidden="true"
    >
      {icon}
    </span>
    <div className="min-w-0">
      <div className="text-base font-semibold text-ink leading-tight">{title}</div>
      <div className="text-xs text-ink-soft mt-1">{sub}</div>
    </div>
  </Link>
);
