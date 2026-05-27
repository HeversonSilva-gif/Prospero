import type { ReactNode } from "react";

type Props = {
  header: ReactNode;
  hero?: ReactNode;
  sections: ReactNode[];
  actions: ReactNode;
  /** When true, uses tighter padding suitable for rendering inside a modal frame. */
  compact?: boolean;
};

export const DecisionPage = ({
  header,
  hero,
  sections,
  actions,
  compact = false,
}: Props): JSX.Element => (
  <div
    className={
      compact ? "relative min-h-[420px] px-7 pt-6 pb-20" : "relative min-h-[580px] px-9 pt-8 pb-24"
    }
  >
    {header}
    {hero}
    <div className="space-y-7">{sections}</div>
    {actions}
  </div>
);
