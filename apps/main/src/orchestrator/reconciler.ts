// Safety-net reconciler for the autonomous loop.
//
// The scheduler (drainScheduler) only sees the in-memory router queue — it has
// no knowledge of the issues board. So when a worker finishes its turn and goes
// idle, or leaves an issue in 'review', or the whole team stalls with a full
// backlog, nothing re-engages the CEO and the org freezes mid-flight (observed
// in a real run: 16 idle agents with 15 'todo' + 10 'review' issues unworked).
//
// This decides — purely — whether to wake the LIVE CEO (see findActiveCeo) to
// orchestrate: review completed work, assign/delegate pending work, unblock
// stalled agents. The CEO stays the single orchestrator (matches the product
// design); this only guarantees it gets woken when the board needs it. The
// caller debounces per-CEO so a confused CEO can't be re-woken every tick, and
// skips entirely while the CEO is already engaged.

export type ReconcileCounts = {
  /** Issues awaiting pickup. */
  todo: number;
  /** Issues a worker is (supposedly) progressing. */
  doing: number;
  /** Issues a worker finished and left for review — the CEO must review them. */
  review: number;
};

export type VerificationFailedGoal = { id: string; title: string; failedCriteria: string[] };

export type ReconcileInput = {
  /** The live CEO id (findActiveCeo result), or null when the company has none. */
  ceoId: string | null;
  /** CEO already running or has queued work — don't pile on another wake. */
  ceoEngaged: boolean;
  /** Any non-CEO agent currently running or with queued work. */
  anyWorkerEngaged: boolean;
  /** Any non-CEO, non-terminated agent that is idle (free capacity). Lets the
   *  reconciler wake the CEO when there is unstarted `todo` work AND a free hand
   *  to do it, even though the team isn't fully stalled — the partial-idle gap
   *  (Bug 2, 2026-06-04) where a finished/unstuck worker leaves its todo unworked
   *  while another worker is still busy. */
  anyWorkerIdle: boolean;
  counts: ReconcileCounts;
  /** Goals that failed verification and returned to in_progress with all issues done. */
  verificationFailedGoals: VerificationFailedGoal[];
  /** When this CEO was last woken by the reconciler (null = never). */
  ceoLastWakeAt: number | null;
  now: number;
  debounceMs: number;
};

export type ReconcileDecision = { wake: false } | { wake: true; ceoId: string; summary: string };

export const computeReconcileDecision = (input: ReconcileInput): ReconcileDecision => {
  const {
    ceoId,
    ceoEngaged,
    anyWorkerEngaged,
    anyWorkerIdle,
    counts,
    verificationFailedGoals,
    ceoLastWakeAt,
    now,
    debounceMs,
  } = input;
  if (ceoId === null) return { wake: false }; // no live CEO — only a human can step in
  if (ceoEngaged) return { wake: false }; // CEO already on it
  const failedCount = verificationFailedGoals.length;
  const actionable = counts.todo + counts.doing + counts.review + failedCount;
  if (actionable === 0) return { wake: false }; // nothing to orchestrate
  const stalled = !anyWorkerEngaged; // whole team idle but work remains
  const reviewPending = counts.review > 0; // CEO must review (human only at goal close)
  const verificationFailedPending = failedCount > 0;
  // Unstarted work with a free hand to do it: a worker is idle but `todo` work
  // sits unworked (its assignee went idle / was just unstuck). The team isn't
  // fully stalled, but the CEO must orchestrate — assign/poke the idle worker.
  const idleWithUnstartedWork = counts.todo > 0 && anyWorkerIdle;
  // Workers are progressing and nothing is waiting on the CEO → leave them be.
  if (!stalled && !reviewPending && !verificationFailedPending && !idleWithUnstartedWork) {
    return { wake: false };
  }
  if (ceoLastWakeAt !== null && now - ceoLastWakeAt < debounceMs) return { wake: false };
  return {
    wake: true,
    ceoId,
    // Head reflects the REAL stall state; the assign/poke block shows whenever the
    // team is stalled OR there is a free hand and unstarted work.
    summary: buildSummary(
      counts,
      stalled,
      stalled || idleWithUnstartedWork,
      reviewPending,
      verificationFailedGoals,
    ),
  };
};

const buildSummary = (
  counts: ReconcileCounts,
  stalled: boolean,
  needsAssign: boolean,
  reviewPending: boolean,
  verificationFailedGoals: VerificationFailedGoal[],
): string => {
  const head = stalled
    ? "[ORQUESTRACAO] O quadro tem trabalho pendente e ninguem esta progredindo."
    : "[ORQUESTRACAO] Ha trabalho aguardando sua acao como gestor.";
  const board = `Estado do quadro: ${String(counts.todo)} a fazer, ${String(counts.doing)} em andamento, ${String(counts.review)} aguardando revisao.`;
  const actions: string[] = ["Use list_issues para ver os detalhes."];
  if (reviewPending) {
    actions.push(
      "Revise cada tarefa em 'review': se estiver boa, aprove movendo para 'done' com update_issue; se faltar algo, devolva ao responsavel com message_agent explicando o ajuste. Voce decide a revisao — nao escale ao humano.",
    );
  }
  if (needsAssign) {
    actions.push(
      "Atribua o trabalho pendente com assign_issue e acorde o responsavel com message_agent. Se algum agente travou, destrave-o.",
    );
  }
  if (verificationFailedGoals.length > 0) {
    const lines = verificationFailedGoals.map(
      (g) =>
        `- "${g.title}" falhou em: ${g.failedCriteria.length > 0 ? g.failedCriteria.join("; ") : "(criterios)"}`,
    );
    actions.push(
      [
        "Estes objetivos falharam na verificacao e voltaram para in_progress, mas as tarefas estao concluidas — reabra a tarefa relevante e mande corrigir:",
        ...lines,
        "Para cada um: reabra a tarefa com update_issue (status para 'todo'), reatribua com assign_issue e acorde o responsavel com message_agent explicando o que falhou. Voce decide — nao escale ao humano.",
      ].join("\n"),
    );
  }
  return [head, board, ...actions].join("\n");
};
