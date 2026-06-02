import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@prospero/shared";
import { StatusDot } from "../ui/StatusDot.js";
import { agentStatusInfo } from "../../lib/status.js";

type Props = { agent: Agent };

const initialsOf = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed === "") return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
};

export const TeamMemberRow: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const info = agentStatusInfo(agent.status);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-t border-surface-border first:border-t-0">
      <span
        className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold bg-brand-bg text-brand flex-shrink-0"
        aria-hidden="true"
      >
        {initialsOf(agent.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink truncate">{agent.name}</div>
        <div className={`text-xs flex items-center gap-1.5 ${info.textClass}`}>
          <StatusDot status={agent.status} />
          <span className="truncate font-mono text-[11px]">{t(info.labelKey)}</span>
        </div>
      </div>
    </div>
  );
};
