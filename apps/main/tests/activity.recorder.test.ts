import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { ActivityEventRow } from "@prospero/shared";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createRecorder } from "../src/activity/recorder.js";

type Broadcast = (row: ActivityEventRow) => void;

const setup = (devMode = true) => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companies = createCompaniesRepository(db);
  const company = companies.create({ name: "Acme" });
  const broadcast = vi.fn<Broadcast>();
  const recorder = createRecorder(db, broadcast, { devMode });
  return { db, companyId: company.id, recorder, broadcast };
};

describe("recorder.recordActivity", () => {
  it("inserts a valid row and returns it", () => {
    const { db, companyId, recorder } = setup();
    const row = recorder.recordActivity({
      companyId,
      actor: { kind: "user" },
      action: "agent.model_changed",
      entityKind: "agent",
      entityId: "agent_x",
      payload: { from: "sonnet-4-6", to: "opus-4-7" },
    });
    expect(row.id.startsWith("act_")).toBe(true);
    expect(row.createdAt).toBeGreaterThan(0);
    expect(row.action).toBe("agent.model_changed");
    const stored = db.prepare("SELECT COUNT(*) AS n FROM activity_events").get() as { n: number };
    expect(stored.n).toBe(1);
  });

  it("dev mode: throws on Zod payload shape mismatch", () => {
    const { companyId, recorder } = setup();
    expect(() =>
      recorder.recordActivity({
        companyId,
        actor: { kind: "user" },
        action: "agent.model_changed",
        entityKind: "agent",
        entityId: "agent_x",
        payload: { from: "sonnet-4-6" }, // missing `to`
      }),
    ).toThrow(/payload validation/i);
  });

  it("prod mode: invalid payload warns and falls back to {}", () => {
    const { db, companyId, recorder } = setup(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    recorder.recordActivity({
      companyId,
      actor: { kind: "user" },
      action: "agent.model_changed",
      entityKind: "agent",
      entityId: "agent_x",
      payload: { from: "sonnet-4-6" }, // missing `to`
    });
    expect(warn).toHaveBeenCalled();
    const row = db.prepare("SELECT payload_json FROM activity_events").get() as {
      payload_json: string;
    };
    expect(JSON.parse(row.payload_json)).toEqual({});
    warn.mockRestore();
  });

  it("dev mode: throws on unknown action", () => {
    const { companyId, recorder } = setup();
    expect(() =>
      recorder.recordActivity({
        companyId,
        actor: { kind: "system" },
        // @ts-expect-error — testing unknown action at runtime
        action: "agent.does_not_exist",
        entityKind: "agent",
        entityId: "agent_x",
        payload: {},
      }),
    ).toThrow(/unknown action/i);
  });

  it("dev mode: throws on payload > 4KB", () => {
    const { companyId, recorder } = setup();
    const big = { reason: "x".repeat(5000) };
    expect(() =>
      recorder.recordActivity({
        companyId,
        actor: { kind: "user" },
        action: "agent.terminated",
        entityKind: "agent",
        entityId: "agent_x",
        payload: big,
      }),
    ).toThrow(/payload size/i);
  });

  it("prod mode: payload > 4KB is truncated and _truncated flag is set", () => {
    const { db, companyId, recorder } = setup(false);
    recorder.recordActivity({
      companyId,
      actor: { kind: "user" },
      action: "agent.terminated",
      entityKind: "agent",
      entityId: "agent_x",
      payload: { reason: "x".repeat(5000) },
    });
    const row = db.prepare("SELECT payload_json FROM activity_events").get() as {
      payload_json: string;
    };
    const parsed = JSON.parse(row.payload_json) as { _truncated?: boolean };
    expect(parsed._truncated).toBe(true);
    expect(row.payload_json.length).toBeLessThanOrEqual(4096);
  });

  it("infers agent_id from actor.kind='agent' when not overridden", () => {
    const { db, companyId, recorder } = setup();
    recorder.recordActivity({
      companyId,
      actor: { kind: "agent", id: "agent_ceo" },
      action: "issue.created",
      entityKind: "issue",
      entityId: "iss_1",
      payload: { identifier: "BACK-1", title: "X", assigneeAgentId: null },
    });
    const row = db.prepare("SELECT agent_id, actor_kind, actor_id FROM activity_events").get() as {
      agent_id: string;
      actor_kind: string;
      actor_id: string;
    };
    expect(row.agent_id).toBe("agent_ceo");
    expect(row.actor_kind).toBe("agent");
    expect(row.actor_id).toBe("agent_ceo");
  });

  it("respects explicit agentId override even when actor is user", () => {
    const { db, companyId, recorder } = setup();
    recorder.recordActivity({
      companyId,
      actor: { kind: "user" },
      agentId: "agent_backend",
      action: "agent.paused",
      entityKind: "agent",
      entityId: "agent_backend",
      payload: { reason: "manual pause" },
    });
    const row = db.prepare("SELECT agent_id, actor_kind, actor_id FROM activity_events").get() as {
      agent_id: string;
      actor_kind: string;
      actor_id: string | null;
    };
    expect(row.agent_id).toBe("agent_backend");
    expect(row.actor_kind).toBe("user");
    expect(row.actor_id).toBeNull();
  });

  it("calls broadcast(row) once after insert", () => {
    const { companyId, recorder, broadcast } = setup();
    recorder.recordActivity({
      companyId,
      actor: { kind: "system" },
      action: "company.created",
      entityKind: "company",
      entityId: companyId,
      payload: { name: "Acme" },
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    const arg = broadcast.mock.calls[0]![0];
    expect(arg.action).toBe("company.created");
    expect(arg.payload).toEqual({ name: "Acme" });
  });

  it("populates id with act_<uuid> prefix and createdAt close to Date.now()", () => {
    const { companyId, recorder } = setup();
    const before = Date.now();
    const row = recorder.recordActivity({
      companyId,
      actor: { kind: "system" },
      action: "company.updated",
      entityKind: "company",
      entityId: companyId,
      payload: { patch: { name: "Acme2" } },
    });
    expect(row.id).toMatch(/^act_[0-9a-f-]{36}$/);
    expect(row.createdAt).toBeGreaterThanOrEqual(before);
  });
});
