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

export type ReconcileInput = {
  /** The live CEO id (findActiveCeo result), or null when the company has none. */
  ceoId: string | null;
  /** CEO already running or has queued work — don't pile on another wake. */
  ceoEngaged: boolean;
  /** Any non-CEO agent currently running or with queued work. */
  anyWorkerEngaged: boolean;
  counts: ReconcileCounts;
  /** When this CEO was last woken by the reconciler (null = never). */
  ceoLastWakeAt: number | null;
  now: number;
  debounceMs: number;
};

export type ReconcileDecision = { wake: false } | { wake: true; ceoId: string; summary: string };

export const computeReconcileDecision = (input: ReconcileInput): ReconcileDecision => {
  const { ceoId, ceoEngaged, anyWorkerEngaged, counts, ceoLastWakeAt, now, debounceMs } = input;
  if (ceoId === null) return { wake: false }; // no live CEO — only a human can step in
  if (ceoEngaged) return { wake: false }; // CEO already on it
  const actionable = counts.todo + counts.doing + counts.review;
  if (actionable === 0) return { wake: false }; // nothing to orchestrate
  const stalled = !anyWorkerEngaged; // whole team idle but work remains
  const reviewPending = counts.review > 0; // CEO must review (human only at goal close)
  // Workers are progressing and nothing is waiting on the CEO → leave them be.
  if (!stalled && !reviewPending) return { wake: false };
  if (ceoLastWakeAt !== null && now - ceoLastWakeAt < debounceMs) return { wake: false };
  return { wake: true, ceoId, summary: buildSummary(counts, stalled, reviewPending) };
};

const buildSummary = (
  counts: ReconcileCounts,
  stalled: boolean,
  reviewPending: boolean,
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
  if (stalled) {
    actions.push(
      "Atribua o trabalho pendente com assign_issue e acorde o responsavel com message_agent. Se algum agente travou, destrave-o.",
    );
  }
  return [head, board, ...actions].join("\n");
};
