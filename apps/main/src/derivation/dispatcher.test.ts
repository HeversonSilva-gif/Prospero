import { describe, it, expect } from "vitest";
import { createDerivationDispatcher } from "./dispatcher.js";
import type { DerivationJob } from "./worker.js";
import type { ActivityEventRow } from "@prospero/shared";

const row = (over: Partial<ActivityEventRow>): ActivityEventRow => ({
  id: "evt_1",
  companyId: "c1",
  actorKind: "agent",
  actorId: "a1",
  action: "issue.status_changed",
  entityKind: "issue",
  entityId: "i1",
  agentId: "a1",
  payload: {},
  createdAt: 0,
  ...over,
});

const collect = (): { jobs: DerivationJob[]; processJob: (j: DerivationJob) => Promise<void> } => {
  const jobs: DerivationJob[] = [];
  return {
    jobs,
    processJob: (j) => {
      jobs.push(j);
      return Promise.resolve();
    },
  };
};

describe("createDerivationDispatcher", () => {
  it("enqueues an issue_done job for an issue moved to done", async () => {
    const { jobs, processJob } = collect();
    const d = createDerivationDispatcher({ processJob });
    d.onActivity(row({ action: "issue.status_changed", payload: { from: "doing", to: "done" } }));
    await d.idle();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ trigger: "issue_done", issueId: "i1", agentId: "a1" });
  });

  it("ignores an issue status change that is not to done", async () => {
    const { jobs, processJob } = collect();
    const d = createDerivationDispatcher({ processJob });
    d.onActivity(row({ payload: { from: "todo", to: "doing" } }));
    await d.idle();
    expect(jobs).toHaveLength(0);
  });

  it("enqueues a recovery job for agent.recovered", async () => {
    const { jobs, processJob } = collect();
    const d = createDerivationDispatcher({ processJob });
    d.onActivity(
      row({ action: "agent.recovered", entityKind: "agent", entityId: "a1", payload: {} }),
    );
    await d.idle();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ trigger: "recovery", agentId: "a1" });
  });

  it("ignores unrelated actions and rows with no agentId", async () => {
    const { jobs, processJob } = collect();
    const d = createDerivationDispatcher({ processJob });
    d.onActivity(row({ action: "issue.created", payload: {} }));
    d.onActivity(row({ action: "issue.status_changed", payload: { to: "done" }, agentId: null }));
    await d.idle();
    expect(jobs).toHaveLength(0);
  });
});
