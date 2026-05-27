import type { ReactNode } from "react";

type Props = {
  header: ReactNode;
  hero?: ReactNode;
  sections: ReactNode[];
  actions: ReactNode;
};

export const DecisionPage = ({ header, hero, sections, actions }: Props): JSX.Element => (
  <div className="relative min-h-[580px] px-9 pt-8 pb-24">
    {header}
    {hero}
    <div className="space-y-7">{sections}</div>
    {actions}
  </div>
);
