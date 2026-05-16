import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { createDerivationWorker } from "../../src/derivation/worker.js";
import { createDerivationDispatcher } from "../../src/derivation/dispatcher.js";
import { createSkillCandidatesRepository } from "../../src/memory/skill-candidates-repository.js";
import type { ActivityEventRow } from "@prospero/shared";

describe("M11 derivation — activity row to skill candidate", () => {
  it("an issue.status_changed-to-done row produces a skill_candidate + inbox item", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
         allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO issues (id, company_id, title, description, status, priority, created_at, updated_at)
       VALUES ('i1','c1','Fix redis','flakes','done','high',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO activity_events (id, company_id, actor_kind, actor_id, action, entity_kind,
         entity_id, agent_id, payload_json, created_at)
       VALUES ('evt_1','c1','agent','a1','issue.status_changed','issue','i1','a1','{}',0)`,
    ).run();

    const worker = createDerivationWorker({
      db,
      runDerivation: () =>
        Promise.resolve({
          text: '```json\n{"name":"redis-fix","description":"how","body":"1. do it"}\n```',
          usage: { input: 10, output: 5, cacheCreation: 0, cacheRead: 0 },
        }),
      now: () => 1000,
      authEnv: () => ({}),
    });
    const dispatcher = createDerivationDispatcher({ processJob: (job) => worker.processJob(job) });

    const row: ActivityEventRow = {
      id: "evt_1",
      companyId: "c1",
      actorKind: "agent",
      actorId: "a1",
      action: "issue.status_changed",
      entityKind: "issue",
      entityId: "i1",
      agentId: "a1",
      payload: { from: "doing", to: "done" },
      createdAt: 0,
    };
    dispatcher.onActivity(row);
    await dispatcher.idle();

    const pending = createSkillCandidatesRepository(db).listPending("c1");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposedName).toBe("redis-fix");
    const inbox = db
      .prepare("SELECT kind FROM inbox_items WHERE company_id = 'c1'")
      .all() as Array<{ kind: string }>;
    expect(inbox.map((i) => i.kind)).toEqual(["skill_candidate_pending"]);
  });
});
