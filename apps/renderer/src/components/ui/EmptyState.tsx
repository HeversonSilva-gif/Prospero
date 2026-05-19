import type { FC, ReactNode } from "react";

type Props = { message: string; icon?: ReactNode };

export const EmptyState: FC<Props> = ({ message, icon }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
    {icon !== undefined && <div className="text-2xl opacity-40">{icon}</div>}
    <p className="text-xs text-ink-soft">{message}</p>
  </div>
);
