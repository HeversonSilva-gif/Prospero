import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  header: ReactNode;
  hero?: ReactNode;
  sections: ReactNode[];
  actions: ReactNode;
};

export const DecisionModal = ({
  open,
  onClose,
  header,
  hero,
  sections,
  actions,
}: Props): JSX.Element | null => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface border border-surface-border rounded-lg max-w-[680px] w-full mx-auto overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative min-h-[520px] px-7 pt-6 pb-20">
          {header}
          {hero}
          <div className="space-y-7">{sections}</div>
          {actions}
        </div>
      </div>
    </div>
  );
};
