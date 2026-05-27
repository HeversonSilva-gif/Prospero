import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createApprovalsRepository } from "./repository.js";
import {
  setApprovalEngineBridge,
  __resetApprovalEngine,
  type ApprovalEngineBridge,
} from "./index.js";
import { handleApprovalEvent } from "./event-handler.js";
import type { Agent } from "@prospero/shared";

const ceo = { id: "ceo1", companyId: "c1", status: "idle", name: "CEO" } as unknown as Agent;
const bot = { id: "bot1", companyId: "c1", status: "idle", name: "Bot" } as unknown as Agent;

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  applyMigrations(d);
  d.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',?)").run(Date.now());
  for (const a of [ceo, bot]) {
    d.prepare(
      `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,created_at,updated_at)
       VALUES (?,?,?,'engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
    ).run(a.id, "c1", a.name, Date.now(), Date.now());
  }
  return d;
}

function makeBridge(
  db: Database.Database,
  over: Partial<ApprovalEngineBridge> = {},
): ApprovalEngineBridge {
  return {
    db,
    getAgent: (id) => (id === "ceo1" ? ceo : id === "bot1" ? bot : null),
    getCeo: () => ceo,
    ensureAgentRunner: vi.fn(),
    enqueue: vi.fn(),
    primaryThreadId: () => "th",
    recordActivity: vi.fn(),
    createHumanCard: vi.fn(),
    createCeoDecisionCard: vi.fn(),
    ...over,
  };
}

describe("handleApprovalEvent", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });
  afterEach(() => {
    __resetApprovalEngine();
  });

  it("is a no-op when the engine bridge is unset", () => {
    // No setApprovalEngineBridge call — bridge is null.
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "x", thread_id: "th1" },
    });
    handleApprovalEvent({
      kind: "approval.route",
      agentId: "bot1",
      companyId: "c1",
      payload: { approvalId: apv.id, managerTopic: "hire" },
    });
    expect(repo.getById(apv.id)?.routedTo).toBeNull();
  });

  it("ignores non-approval.* kinds", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    handleApprovalEvent({
      kind: "agent.deliver",
      agentId: "bot1",
      companyId: "c1",
      payload: {},
    });
    expect(bridge.enqueue).not.toHaveBeenCalled();
    expect(bridge.createHumanCard).not.toHaveBeenCalled();
    expect(bridge.createCeoDecisionCard).not.toHaveBeenCalled();
  });

  it("approval.route on a manager_request routes to the CEO (wakes, sets routedTo)", () => {
    vi.useFakeTimers();
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "Preciso de um designer", thread_id: "th1" },
    });
    handleApprovalEvent({
      kind: "approval.route",
      agentId: "bot1",
      companyId: "c1",
      payload: {
        approvalId: apv.id,
        requesterIsCeo: false,
        requesterName: "Bot",
        summary: "Preciso de um designer",
        managerTopic: "hire",
        budgetOverLimit: false,
      },
    });
    expect(repo.getById(apv.id)?.routedTo).toBe("ceo");
    // Wake is deferred by the coalescer — advance the 60s window.
    vi.advanceTimersByTime(60_000);
    expect(bridge.enqueue).toHaveBeenCalled();
    expect(bridge.createHumanCard).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("approval.route routes to the human when no CEO is available", () => {
    const bridge = makeBridge(db, { getCeo: () => null });
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "x", thread_id: "th1" },
    });
    handleApprovalEvent({
      kind: "approval.route",
      agentId: "bot1",
      companyId: "c1",
      payload: { approvalId: apv.id, requesterIsCeo: false, managerTopic: "hire" },
    });
    expect(repo.getById(apv.id)?.routedTo).toBe("user");
    expect(bridge.createHumanCard).toHaveBeenCalledWith(apv.id);
    expect(bridge.enqueue).not.toHaveBeenCalled();
  });

  it("approval.decided manager_request approve decides the row + delivers + cards", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "Preciso de um designer", thread_id: "th1" },
    });
    repo.setRouted(apv.id, "ceo");
    handleApprovalEvent({
      kind: "approval.decided",
      agentId: "ceo1",
      companyId: "c1",
      payload: {
        approvalId: apv.id,
        decision: "approve",
        note: "ok",
        kind: "manager_request",
      },
    });
    const after = repo.getById(apv.id);
    expect(after?.status).toBe("approved");
    expect(after?.decidedBy).toBe("ceo1");
    expect(after?.decisionNote).toBe("ok");
    // deliverManagerDecision wakes the requester via enqueue.
    expect(bridge.enqueue).toHaveBeenCalled();
    expect(bridge.createCeoDecisionCard).toHaveBeenCalledWith(apv.id, "approved");
  });

  it("approval.decided manager_request reject decides the row as rejected", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "x", thread_id: "th1" },
    });
    repo.setRouted(apv.id, "ceo");
    handleApprovalEvent({
      kind: "approval.decided",
      agentId: "ceo1",
      companyId: "c1",
      payload: { approvalId: apv.id, decision: "reject", note: "no", kind: "manager_request" },
    });
    const after = repo.getById(apv.id);
    expect(after?.status).toBe("rejected");
    expect(bridge.createCeoDecisionCard).toHaveBeenCalledWith(apv.id, "rejected");
  });

  it("approval.decided manager_request is a no-op if already resolved", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "x", thread_id: "th1" },
    });
    repo.setRouted(apv.id, "ceo");
    repo.decide(apv.id, "approved", "user");
    handleApprovalEvent({
      kind: "approval.decided",
      agentId: "ceo1",
      companyId: "c1",
      payload: { approvalId: apv.id, decision: "reject", note: "x", kind: "manager_request" },
    });
    // Status unchanged; no card created off the stale decision.
    expect(repo.getById(apv.id)?.status).toBe("approved");
    expect(bridge.createCeoDecisionCard).not.toHaveBeenCalled();
  });

  it("approval.decided tool_call cancels timer + drops CEO card; MAIN does not call repo.decide()", () => {
    // Note: decide_request.run() (MCP child) now calls repo.decide() immediately
    // before emitting this event. MAIN's handleApprovalEvent intentionally does
    // NOT call repo.decide() for tool_call — it only cancels the escalation timer
    // and drops the CEO decision card. This test asserts that invariant.
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tu1" },
    });
    repo.setRouted(apv.id, "ceo");
    handleApprovalEvent({
      kind: "approval.decided",
      agentId: "ceo1",
      companyId: "c1",
      payload: { approvalId: apv.id, decision: "approve", note: "", kind: "tool_call" },
    });
    // MAIN does not own repo.decide for tool_call (decide_request in the MCP
    // child already did it). Status is still "pending" here because this test
    // calls handleApprovalEvent in isolation without going through decide_request.
    expect(repo.getById(apv.id)?.status).toBe("pending");
    expect(bridge.createCeoDecisionCard).toHaveBeenCalledWith(apv.id, "approved");
  });

  it("approval.escalate hands the decision to the human", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "x", thread_id: "th1" },
    });
    repo.setRouted(apv.id, "ceo");
    handleApprovalEvent({
      kind: "approval.escalate",
      agentId: "ceo1",
      companyId: "c1",
      payload: { approvalId: apv.id },
    });
    expect(repo.getById(apv.id)?.routedTo).toBe("user");
    expect(repo.getById(apv.id)?.escalatedAt).not.toBeNull();
    expect(bridge.createHumanCard).toHaveBeenCalledWith(apv.id);
  });
});
