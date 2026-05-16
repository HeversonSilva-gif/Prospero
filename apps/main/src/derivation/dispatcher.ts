import type { ActivityEventRow } from "@prospero/shared";
import type { DerivationJob } from "./worker.js";

export type DerivationDispatcher = {
  // Inspects one written activity row; enqueues a job if it is a trigger.
  // Returns synchronously — never blocks the activity write (spec §2.1).
  onActivity(row: ActivityEventRow): void;
  // Resolves when the queue has drained — for tests.
  idle(): Promise<void>;
};

// Decides the job (if any) for an activity row. Exported for clarity / testing.
export const jobForActivity = (row: ActivityEventRow): DerivationJob | null => {
  if (row.agentId === null) return null;
  if (row.action === "issue.status_changed" && row.payload["to"] === "done") {
    return {
      trigger: "issue_done",
      companyId: row.companyId,
      agentId: row.agentId,
      sourceEventId: row.id,
      issueId: row.entityId,
    };
  }
  if (row.action === "agent.recovered") {
    return {
      trigger: "recovery",
      companyId: row.companyId,
      agentId: row.agentId,
      sourceEventId: row.id,
    };
  }
  return null;
};

export const createDerivationDispatcher = (deps: {
  processJob: (job: DerivationJob) => Promise<void>;
}): DerivationDispatcher => {
  const queue: DerivationJob[] = [];
  let draining: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        await deps.processJob(job);
      } catch (err) {
        console.warn(`[derivation] dispatcher job failed: ${String(err)}`);
      }
    }
    draining = null;
  };

  return {
    onActivity(row) {
      const job = jobForActivity(row);
      if (job === null) return;
      queue.push(job);
      if (draining === null) draining = drain();
    },
    idle() {
      return draining ?? Promise.resolve();
    },
  };
};
