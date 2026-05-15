import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createAgentsRepository } from "./repository.js";
import { createActivityRepository } from "../activity/repository.js";
import { createRecorder } from "../activity/recorder.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('co_1', 'Demo', 0)").run();
  const recorder = createRecorder(db, () => {}, { devMode: false });
  const repo = createAgentsRepository(db, recorder);
  const activityRepo = createActivityRepository(db);
  const agent = repo.create({
    companyId: "co_1",
    name: "BackendEng",
    role: "BackendEng",
    systemPrompt: "x".repeat(40),
    mode: "supervised",
    alwaysOn: false,
  });
  return { db, repo, activityRepo, agent };
};

describe("repository lifecycle methods", () => {
  it("setMode updates mode and records activity.mode_changed", () => {
    const { repo, activityRepo, agent } = setup();
    repo.setMode(agent.id, "auto");
    const fresh = repo.getById(agent.id)!;
    expect(fresh.mode).toBe("auto");
    const events = activityRepo.query({
      companyId: "co_1",
      filters: { action: "agent.mode_changed" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ from: "supervised", to: "auto" });
  });

  it("setAlwaysOn flips alwaysOn and records activity", () => {
    const { repo, activityRepo, agent } = setup();
    repo.setAlwaysOn(agent.id, true);
    const fresh = repo.getById(agent.id)!;
    expect(fresh.alwaysOn).toBe(true);
    const events = activityRepo.query({
      companyId: "co_1",
      filters: { action: "agent.always_on_changed" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ from: false, to: true });
  });

  it("setCapabilities records added/removed deltas in payload", () => {
    const { repo, activityRepo, agent } = setup();
    repo.setCapabilities(agent.id, ["read_code", "run_tests"]);
    repo.setCapabilities(agent.id, ["read_code", "git_ops"]);
    const fresh = repo.getById(agent.id)!;
    expect(fresh.capabilities).toEqual(["read_code", "git_ops"]);
    const events = activityRepo.query({
      companyId: "co_1",
      filters: { action: "agent.capabilities_changed" },
    });
    expect(events).toHaveLength(2);
    // Two same-ms inserts: ordering is by id DESC (UUID random) — assert set.
    const payloads = events.map((e) => e.payload);
    expect(payloads).toContainEqual({ added: ["git_ops"], removed: ["run_tests"] });
    expect(payloads).toContainEqual({ added: ["read_code", "run_tests"], removed: [] });
  });

  it("pause sets status+paused_at+pause_reason; resume clears all three", () => {
    const { repo, activityRepo, agent } = setup();
    repo.pause(agent.id, "manual via UI");
    const paused = repo.getById(agent.id)!;
    expect(paused.status).toBe("paused");
    expect(paused.pauseReason).toBe("manual via UI");
    expect(paused.pausedAt).not.toBeNull();

    repo.resume(agent.id);
    const resumed = repo.getById(agent.id)!;
    expect(resumed.status).toBe("idle");
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.pauseReason).toBeNull();

    const pausedEvents = activityRepo.query({
      companyId: "co_1",
      filters: { action: "agent.paused" },
    });
    const resumedEvents = activityRepo.query({
      companyId: "co_1",
      filters: { action: "agent.resumed" },
    });
    expect(pausedEvents).toHaveLength(1);
    expect(pausedEvents[0]!.payload).toEqual({ reason: "manual via UI" });
    expect(resumedEvents).toHaveLength(1);
  });

  it("pause without reason records empty payload", () => {
    const { repo, activityRepo, agent } = setup();
    repo.pause(agent.id);
    const events = activityRepo.query({
      companyId: "co_1",
      filters: { action: "agent.paused" },
    });
    expect(events[0]!.payload).toEqual({});
  });

  it("terminate sets status='terminated' + terminated_at; row remains for audit", () => {
    const { repo, activityRepo, agent } = setup();
    repo.terminate(agent.id, "fired by user");
    const fresh = repo.getById(agent.id)!;
    expect(fresh.status).toBe("terminated");
    expect(fresh.terminatedAt).not.toBeNull();
    const events = activityRepo.query({
      companyId: "co_1",
      filters: { action: "agent.terminated" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ reason: "fired by user" });
  });

  it("terminate without reason records empty payload", () => {
    const { repo, activityRepo, agent } = setup();
    repo.terminate(agent.id);
    const events = activityRepo.query({
      companyId: "co_1",
      filters: { action: "agent.terminated" },
    });
    expect(events[0]!.payload).toEqual({});
  });
});
