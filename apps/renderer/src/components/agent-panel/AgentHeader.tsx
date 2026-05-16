import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, AgentStatus } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { OverflowMenu } from "./OverflowMenu.js";
import { TerminateConfirmModal } from "./TerminateConfirmModal.js";

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: "bg-ink-soft",
  thinking: "bg-brand",
  working: "bg-semantic-success",
  waiting: "bg-semantic-warning",
  error: "bg-semantic-danger",
  paused: "bg-semantic-warning",
  terminated: "bg-ink-soft",
};

interface Props {
  agent: Agent;
  onAssignTask: () => void;
  onOpenRuns: () => void;
  skillCount: number;
  memoryCount: number;
  onOpenLearning: () => void;
}

export const AgentHeader: FC<Props> = ({
  agent,
  onAssignTask,
  onOpenRuns,
  skillCount,
  memoryCount,
  onOpenLearning,
}) => {
  const { t } = useTranslation();
  const pause = useAgentsStore((s) => s.pause);
  const resume = useAgentsStore((s) => s.resume);
  const terminate = useAgentsStore((s) => s.terminate);
  const resetSession = useAgentsStore((s) => s.resetSession);
  const [showTerminate, setShowTerminate] = useState(false);

  const isPaused = agent.status === "paused";
  const isTerminated = agent.status === "terminated";
  const canControl = !isTerminated;

  const handlePauseToggle = (): void => {
    if (isPaused) void resume(agent.id);
    else void pause(agent.id);
  };

  return (
    <header className="sticky top-0 z-20 bg-surface border-b border-surface-border px-4 py-2 flex items-center gap-3">
      <span
        className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status]}`}
        title={t(`agent.header.status.${agent.status}`)}
      />
      <span className="text-sm font-semibold text-brand-dark">{agent.name}</span>
      <span className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted">
        {agent.role}
      </span>
      <button
        type="button"
        onClick={onOpenLearning}
        title={t("agent.learning.badgeTitle")}
        className="text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted hover:bg-surface-border"
      >
        🎓 {skillCount} · {memoryCount}
      </button>
      {agent.currentAction !== null && agent.currentAction !== "" && (
        <span className="text-xs italic text-ink-soft truncate flex-1">{agent.currentAction}</span>
      )}
      <div className="flex-1" />

      {canControl && (
        <>
          <button
            type="button"
            onClick={handlePauseToggle}
            className="text-xs px-2 py-1 bg-surface-soft text-ink-muted rounded hover:bg-surface-border"
          >
            {isPaused ? `▶ ${t("agent.header.resume")}` : `⏸ ${t("agent.header.pause")}`}
          </button>
          <button
            type="button"
            onClick={onAssignTask}
            className="text-xs px-2 py-1 bg-brand text-brand-fg rounded"
          >
            + {t("agent.header.assignTask")}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onOpenRuns}
        className="text-xs px-2 py-1 bg-surface-soft text-ink-muted rounded hover:bg-surface-border"
      >
        📜 {t("agent.header.runs")}
      </button>
      <OverflowMenu
        onCopyId={() => void navigator.clipboard.writeText(agent.id)}
        onResetSession={() => void resetSession(agent.id)}
        onTerminate={() => setShowTerminate(true)}
      />

      {showTerminate && (
        <TerminateConfirmModal
          agentName={agent.name}
          onConfirm={(reason) => {
            void terminate(agent.id, reason);
            setShowTerminate(false);
          }}
          onCancel={() => setShowTerminate(false)}
        />
      )}
    </header>
  );
};
