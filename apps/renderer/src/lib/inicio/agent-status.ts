import type { TFunction } from "i18next";
import type { AgentStatus } from "@prospero/shared";

// M16 PR-B1 — maps AgentStatus to {label, dotColor} for the
// "Sua equipe agora" section of Início (and reusable by Minha equipe in PR-C).
// `terminated` is intentionally absent — terminated agents are filtered out
// by the caller before reaching this function.

export type AgentStatusInfo = {
  label: string;
  dotColor: string;
};

const DOT_COLOR: Record<Exclude<AgentStatus, "terminated">, string> = {
  working: "bg-semantic-success",
  thinking: "bg-brand",
  idle: "bg-ink-soft",
  waiting: "bg-semantic-warning",
  paused: "bg-semantic-warning",
  error: "bg-semantic-danger",
};

const I18N_KEY: Record<Exclude<AgentStatus, "terminated">, string> = {
  working: "agentStatus.working",
  thinking: "agentStatus.thinking",
  idle: "agentStatus.idle",
  waiting: "agentStatus.waiting",
  paused: "agentStatus.paused",
  error: "agentStatus.error",
};

export const getAgentStatusInfo = (status: AgentStatus, t: TFunction): AgentStatusInfo => {
  if (status === "terminated") {
    return { label: "", dotColor: "bg-ink-soft" };
  }
  return {
    label: t(I18N_KEY[status]),
    dotColor: DOT_COLOR[status],
  };
};
