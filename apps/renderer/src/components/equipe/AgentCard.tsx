import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { DotsThree } from "@phosphor-icons/react";
import type { Agent } from "@prospero/shared";
import { StatusDot } from "../ui/StatusDot.js";
import { agentStatusInfo } from "../../lib/status.js";

const initialsOf = (name: string): string => {
  const s = name.trim();
  if (s === "") return "?";
  const p = s.split(/\s+/);
  return (p.length === 1 ? p[0]!.slice(0, 2) : (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
};

type Props = {
  agent: Agent;
  hero?: boolean;
  onOpen: () => void;
  onReassign?: () => void;
};

export const AgentCard: FC<Props> = ({ agent, hero = false, onOpen, onReassign }) => {
  const { t } = useTranslation();
  const info = agentStatusInfo(agent.status);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      className={`text-left bg-surface-card border rounded-2xl p-4 cursor-pointer transition-shadow hover:shadow-[0_6px_18px_-10px_rgba(15,118,110,.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
        hero ? "border-brand-soft" : "border-surface-border"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`rounded-lg bg-brand-bg text-brand flex items-center justify-center font-bold flex-shrink-0 ${hero ? "w-11 h-11 text-sm" : "w-9 h-9 text-xs"}`}
          aria-hidden="true"
        >
          {initialsOf(agent.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink truncate">{agent.name}</div>
          <div className="text-xs text-ink-muted truncate">
            {hero ? t("equipe.card.leadsTeam") : agent.role}
          </div>
        </div>
        {onReassign !== undefined && (
          <button
            type="button"
            aria-label={t("equipe.card.menu")}
            onClick={(e) => {
              e.stopPropagation();
              onReassign();
            }}
            className="text-ink-soft hover:text-ink px-1 flex items-center"
          >
            <DotsThree size={18} weight="bold" />
          </button>
        )}
      </div>
      <div className={`mt-2.5 text-xs flex items-center gap-1.5 ${info.textClass}`}>
        <StatusDot status={agent.status} />
        <span className="font-mono text-[11px]">{t(info.labelKey)}</span>
        {agent.currentAction !== null && (
          <span className="text-ink-muted truncate"> · {agent.currentAction}</span>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-surface-border flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-ink-muted bg-surface-soft border border-surface-border rounded px-1.5 py-0.5">
          {agent.model}
        </span>
        {agent.capabilities.slice(0, 4).map((c) => (
          <span
            key={c}
            className="text-[10px] text-ink-muted bg-surface-soft border border-surface-border rounded-full px-2 py-0.5"
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
};
