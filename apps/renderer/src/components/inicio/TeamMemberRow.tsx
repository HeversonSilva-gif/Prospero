import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@prospero/shared";
import { getAgentStatusInfo } from "../../lib/inicio/agent-status.js";

// M16 PR-B1 — row for the "Sua equipe agora" section of Início.
// Avatar (initials, blue bg) + name + status (colored dot + label).

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

export const TeamMemberRow: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const { label, dotColor } = getAgentStatusInfo(agent.status, t);
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span
        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold bg-brand-bg text-brand flex-shrink-0"
        aria-hidden="true"
      >
        {initialsOf(agent.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink truncate">{agent.name}</div>
        <div className="text-xs text-ink-soft flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} aria-hidden="true" />
          <span className="truncate">{label}</span>
        </div>
      </div>
    </div>
  );
};
