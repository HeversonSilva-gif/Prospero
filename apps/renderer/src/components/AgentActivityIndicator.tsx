import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@prospero/shared";

type Props = { agent: Agent | null | undefined };

// Live "the agent is doing something" row for conversation views, so a quiet
// phase (e.g. the CEO drafting an org plan after reading the manual) doesn't
// look frozen. The label is derived from the agent's live status — the backend
// currentAction string is English, so we keep this localized and status-based
// rather than surfacing that string.
export const AgentActivityIndicator: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  if (agent === null || agent === undefined) return null;
  if (agent.status !== "thinking" && agent.status !== "working") return null;

  const action =
    agent.status === "working" ? t("agent.activity.working") : t("agent.activity.thinking");

  return (
    <div className="flex items-center gap-2 text-xs text-ink-soft" aria-live="polite">
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-1.5 h-1.5 rounded-full bg-brand/60 animate-pulse"
            style={{ animationDelay: `${String(delay)}ms` }}
          />
        ))}
      </span>
      <span>{t("agent.activity.line", { name: agent.name, action })}</span>
    </div>
  );
};
