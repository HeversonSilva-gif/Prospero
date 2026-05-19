import type { FC } from "react";

export const LoadingState: FC<{ label?: string }> = ({ label }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-xs text-ink-soft">
    <span className="w-3 h-3 rounded-full border-2 border-ink-soft border-t-transparent animate-spin" />
    {label !== undefined && <span>{label}</span>}
  </div>
);
