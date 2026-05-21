import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@prospero/shared";
import { getAgentStatusInfo } from "../../lib/inicio/agent-status.js";

// M16 PR-C3 — Identidade tab. Display read-only de avatar + nome + role + status.
// Edit-in-place fica pra PR-G ou polish posterior.

type Props = {
  agent: Agent;
};

const initialsOf = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed === "") return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
};

export const IdentidadeTab: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const { label, dotColor } = getAgentStatusInfo(agent.status, t);
  return (
    <div className="p-8 max-w-xl">
      <div className="flex items-center gap-5">
        <span
          className="w-20 h-20 rounded-full flex items-center justify-center text-xl font-bold bg-brand-bg text-brand flex-shrink-0"
          aria-hidden="true"
        >
          {initialsOf(agent.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-ink">{agent.name}</h2>
          {agent.role !== "" && <p className="text-base text-ink-muted mt-1">{agent.role}</p>}
          <div className="flex items-center gap-2 mt-3 text-sm text-ink-soft">
            <span className={`w-2 h-2 rounded-full ${dotColor}`} aria-hidden="true" />
            <span>{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
