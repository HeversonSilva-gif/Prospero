import type { FC } from "react";
import type { Agent, Project } from "@dashboard-agent/shared";

type Props = { agent: Agent; project: Project };

// Stub for Task 7; full impl arrives in Task 8.
export const AllowlistEditor: FC<Props> = ({ agent }) => (
  <span className="text-xs px-2 py-0.5 rounded-full bg-surface-soft text-ink-muted">
    {agent.name}
  </span>
);
