import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createApprovalsRepository } from "./repository.js";
import {
  setApprovalEngineBridge,
  routeAndDispatch,
  escalatePendingOnBoot,
  __resetApprovalEngine,
  type ApprovalEngineBridge,
} from "./index.js";
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

describe("approval engine routeAndDispatch", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });
  afterEach(() => {
    __resetApprovalEngine();
  });

  it("routes a supervised tool_call to the CEO (wakes, no human card)", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tu1" },
    });
    const route = routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "supervised mode",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Write X",
    });
    expect(route).toBe("ceo");
    expect(repo.getById(apv.id)?.routedTo).toBe("ceo");
    expect(bridge.enqueue).toHaveBeenCalled();
    expect(bridge.createHumanCard).not.toHaveBeenCalled();
  });

  it("routes an always-blocked tool_call to the human (card, no wake)", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Bash", tool_input: {}, tool_use_id: "tu2" },
    });
    const route = routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "always-blocked bash pattern",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "rm",
    });
    expect(route).toBe("user");
    expect(repo.getById(apv.id)?.routedTo).toBe("user");
    expect(bridge.createHumanCard).toHaveBeenCalledWith(apv.id);
    expect(bridge.enqueue).not.toHaveBeenCalled();
  });

  it("escalatePendingOnBoot escalates pending CEO-routed approvals to the human", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tu3" },
    });
    repo.setRouted(apv.id, "ceo");
    escalatePendingOnBoot(db, ["c1"]);
    expect(repo.getById(apv.id)?.routedTo).toBe("user");
    expect(repo.getById(apv.id)?.escalatedAt).not.toBeNull();
    expect(bridge.createHumanCard).toHaveBeenCalledWith(apv.id);
  });
});
