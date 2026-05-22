// P2-C — Auto-mode expiry: revert agents from 'auto' to 'supervised' after 24h.
//
// Design rationale:
//   - Modo auto é opt-in por segurança, mas a sessão Claude Max pode durar
//     dias. Sem um timer, um usuário que ativou 'auto' e esqueceu fica com o
//     agente em modo irrestrito indefinidamente.
//   - O timer de 24h é o débito de M5 descrito no ROADMAP §P2-C.
//   - Não revoga se o agente estiver 'paused' ou 'terminated' — nesses estados
//     a reversão seria silenciosa e confusa.
//   - O tick roda a cada 5 min; a janela de expiração real é 24h ± 5min.

import type { Agent, InboxKind } from "@prospero/shared";
import type { Recorder } from "../activity/recorder.js";

/** 24 horas em milissegundos — tempo de expiração do modo auto. */
export const AUTO_MODE_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Intervalo de verificação (5 minutos). */
export const AUTO_MODE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type CreateInboxInput = {
  companyId: string;
  kind: InboxKind;
  actorId?: string | null;
  title: string;
  preview?: string | null;
  requiresAction?: boolean;
  payloadJson?: string | null;
};

export type AutoModeExpiryDeps = {
  /** Returns current time in milliseconds. */
  now: () => number;
  /** Returns agents in 'auto' mode whose auto_mode_set_at is older than expiryMs. */
  listExpiredAutoAgents: (now: number, expiryMs: number) => Agent[];
  /**
   * Reverts the agent to 'supervised' mode. This is the same path as the
   * user manually switching — records activity via the repository's recorder.
   */
  setModeToSupervised: (agentId: string) => void;
  /** Creates an inbox notification for the user. */
  createInboxItem: (input: CreateInboxInput) => void;
  /** Optional activity recorder for the mode-revert event. */
  recorder?: Recorder;
  /**
   * Called after each successful revert so the orchestrator can broadcast a
   * roster-changed event to the renderer.
   */
  onAgentReverted: (agentId: string, companyId: string) => void;
  /** Expiry window in ms. Defaults to AUTO_MODE_EXPIRY_MS. Overridable for tests. */
  expiryMs?: number;
  /** Check interval in ms. Defaults to AUTO_MODE_CHECK_INTERVAL_MS. */
  intervalMs?: number;
};

export type AutoModeExpiry = {
  /** Starts the periodic check loop. Runs one tick immediately. */
  start(): void;
  /** Stops the interval. Safe to call multiple times. */
  stop(): void;
  /** Runs a single check cycle. Exported for unit-testing without timers. */
  tick(): void;
};

export const createAutoModeExpiry = (deps: AutoModeExpiryDeps): AutoModeExpiry => {
  const expiryMs = deps.expiryMs ?? AUTO_MODE_EXPIRY_MS;
  const intervalMs = deps.intervalMs ?? AUTO_MODE_CHECK_INTERVAL_MS;
  let handle: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    const now = deps.now();
    let expired: Agent[];
    try {
      expired = deps.listExpiredAutoAgents(now, expiryMs);
    } catch (err) {
      // DB read errors must not crash the process.
      console.error("[auto-mode-expiry] listExpiredAutoAgents failed:", err);
      return;
    }

    for (const agent of expired) {
      try {
        deps.setModeToSupervised(agent.id);
        deps.createInboxItem({
          companyId: agent.companyId,
          kind: "auto_mode_expired",
          actorId: agent.id,
          title: `Modo auto expirou: ${agent.name}`,
          preview: `${agent.name} voltou automaticamente para modo supervisionado após 24h em modo autônomo.`,
          requiresAction: false,
          payloadJson: JSON.stringify({ agentId: agent.id, agentName: agent.name }),
        });
        deps.recorder?.recordActivity({
          companyId: agent.companyId,
          actor: { kind: "system" },
          action: "agent.mode_changed",
          entityKind: "agent",
          entityId: agent.id,
          agentId: agent.id,
          payload: { from: "auto", to: "supervised", reason: "auto_mode_expired_24h" },
        });
        deps.onAgentReverted(agent.id, agent.companyId);
      } catch (err) {
        // A failure for one agent must not abort the others.
        console.error(`[auto-mode-expiry] failed to revert agent ${agent.id}:`, err);
      }
    }
  };

  return {
    start() {
      // Run immediately so any agents that expired while the app was closed are
      // reverted as soon as the orchestrator boots.
      tick();
      handle = setInterval(tick, intervalMs);
    },
    stop() {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    },
    tick,
  };
};
