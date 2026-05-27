import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createApprovalsRepository } from "./repository.js";
import {
  setApprovalEngineBridge,
  routeAndDispatch,
  escalatePendingOnBoot,
  armBouncesOnBoot,
  CEO_DECISION_TIMEOUT_MS,
  __resetApprovalEngine,
  type ApprovalEngineBridge,
} from "./index.js";
import { saveGovernanceConfig } from "./governance-config.js";
import type { Agent } from "@prospero/shared";
import { DEFAULT_GOVERNANCE_CONFIG } from "@prospero/shared";

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

  it("routeAndDispatch is a no-op when the approval is already routed (duplicate event guard)", () => {
    // Simulates a duplicate approval.route event arriving after the first routing.
    // Without the guard, wakeCeoForApproval would be called twice, causing the CEO
    // to receive two notification messages for the same approval (wasted turns).
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "hire", summary: "Need designer", thread_id: "th1" },
    });
    // Already routed on the first event
    repo.setRouted(apv.id, "ceo");
    // Second (duplicate) event
    const result = routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "manager_request",
      reason: "",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Need designer",
    });
    // Returns existing route without re-waking the CEO.
    expect(result).toBe("ceo");
    expect(bridge.enqueue).not.toHaveBeenCalled(); // no double-wake
    expect(bridge.createHumanCard).not.toHaveBeenCalled();
  });

  it("routeAndDispatch is a no-op when the approval is already decided", () => {
    // Guards against stale events where decide_request already resolved the row
    // (via immediate repo.decide()) before the approval.route event reaches MAIN.
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Write", tool_input: {}, tool_use_id: "tu9" },
    });
    repo.setRouted(apv.id, "ceo");
    repo.decide(apv.id, "approved", "ceo1");
    const result = routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Write file",
    });
    expect(result).toBe("ceo"); // existing routedTo
    expect(bridge.enqueue).not.toHaveBeenCalled();
    expect(bridge.createHumanCard).not.toHaveBeenCalled();
  });
});

describe("routeAndDispatch — async governance integration", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });
  afterEach(() => {
    __resetApprovalEngine();
    vi.useRealTimers();
  });

  it("auto-approves when policy says so — no CEO wake, no human card", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    saveGovernanceConfig(db, "c1", {
      ...DEFAULT_GOVERNANCE_CONFIG,
      policies: {
        ...DEFAULT_GOVERNANCE_CONFIG.policies,
        autoApproveReadOnlyAcrossProjects: true,
      },
    });
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Read", tool_input: {}, tool_use_id: "tu-auto" },
    });
    const route = routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "supervised mode",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Read file",
      toolName: "Read",
    });
    expect(route).toBe("ceo"); // auto-approve returns "ceo" per spec
    const updated = repo.getById(apv.id);
    expect(updated?.status).toBe("approved");
    expect(updated?.decidedBy).toBe("system");
    expect(bridge.createHumanCard).not.toHaveBeenCalled();
    expect(bridge.enqueue).not.toHaveBeenCalled();
    const recordActivity = bridge.recordActivity as ReturnType<typeof vi.fn>;
    const call = recordActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "governance.auto_approved",
    );
    expect(call).toBeDefined();
    expect((call![0] as { payload: { approvalId: string } }).payload.approvalId).toBe(apv.id);
  });

  it("schedules a bounce timer when routed to user; bounceToCEO fires on timeout", () => {
    vi.useFakeTimers();
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    saveGovernanceConfig(db, "c1", {
      ...DEFAULT_GOVERNANCE_CONFIG,
      policies: {
        ...DEFAULT_GOVERNANCE_CONFIG.policies,
        bouncedToCeoTtlHours: 2,
        ceoCanDecideFires: false,
      },
    });
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "fire", summary: "Fire designer", thread_id: "th-fire" },
    });
    const route = routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "manager_request",
      reason: "fire request",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Fire designer",
      managerTopic: "fire",
    });
    // Should route to user (fire, ceoCanDecideFires=false)
    expect(route).toBe("user");
    expect(repo.getById(apv.id)?.routedTo).toBe("user");
    expect(bridge.createHumanCard).toHaveBeenCalledWith(apv.id);
    expect(repo.getById(apv.id)?.bounceCount).toBe(0);

    // Advance past the 2-hour TTL
    vi.advanceTimersByTime(2 * 60 * 60_000);

    // After bounce: routedTo=ceo, bounceCount=1
    expect(repo.getById(apv.id)?.routedTo).toBe("ceo");
    expect(repo.getById(apv.id)?.bounceCount).toBe(1);
    const recordActivity = bridge.recordActivity as ReturnType<typeof vi.fn>;
    const bounceCall = recordActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "approval.bounced_to_ceo",
    );
    expect(bounceCall).toBeDefined();
    // CEO should be woken with the bounce notice
    expect(bridge.enqueue).toHaveBeenCalled();
    const enqueueArgs = (bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(enqueueArgs[2] as string).toContain("Usuário não respondeu");
  });

  it("after bounce + 2nd timeout, approval is default-denied", () => {
    vi.useFakeTimers();
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    saveGovernanceConfig(db, "c1", {
      ...DEFAULT_GOVERNANCE_CONFIG,
      policies: {
        ...DEFAULT_GOVERNANCE_CONFIG.policies,
        bouncedToCeoTtlHours: 2,
        ceoCanDecideFires: false,
      },
    });
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "fire", summary: "Fire designer 2", thread_id: "th-fire2" },
    });
    routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "manager_request",
      reason: "fire request",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Fire designer 2",
      managerTopic: "fire",
    });

    // First timeout: bounce to CEO
    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(repo.getById(apv.id)?.bounceCount).toBe(1);
    expect(repo.getById(apv.id)?.status).toBe("pending");

    // Second timeout: CEO escalation timer fires
    vi.advanceTimersByTime(CEO_DECISION_TIMEOUT_MS);
    const updated = repo.getById(apv.id);
    expect(updated?.status).toBe("rejected");
    expect(updated?.decisionNote).toContain("ceo timeout after bounce");
    const recordActivity = bridge.recordActivity as ReturnType<typeof vi.fn>;
    const denyCall = recordActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "approval.default_denied_final",
    );
    expect(denyCall).toBeDefined();
  });

  it("decide cancels bounce timer — bounceToCEO does not fire", () => {
    vi.useFakeTimers();
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    saveGovernanceConfig(db, "c1", {
      ...DEFAULT_GOVERNANCE_CONFIG,
      policies: {
        ...DEFAULT_GOVERNANCE_CONFIG.policies,
        bouncedToCeoTtlHours: 2,
        ceoCanDecideFires: false,
      },
    });
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "manager_request",
      payload: { topic: "fire", summary: "Fire designer 3", thread_id: "th-fire3" },
    });
    routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "manager_request",
      reason: "fire request",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Fire designer 3",
      managerTopic: "fire",
    });
    expect(repo.getById(apv.id)?.routedTo).toBe("user");

    // Human decides before timeout
    repo.decide(apv.id, "approved", "human1");

    // Advance past the TTL — bounce should NOT fire since approval is resolved
    vi.advanceTimersByTime(2 * 60 * 60_000);

    // bounceCount stays 0 and status stays approved
    expect(repo.getById(apv.id)?.bounceCount).toBe(0);
    expect(repo.getById(apv.id)?.status).toBe("approved");
    const recordActivity = bridge.recordActivity as ReturnType<typeof vi.fn>;
    const bounceCall = recordActivity.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "approval.bounced_to_ceo",
    );
    expect(bounceCall).toBeUndefined();
  });

  it("requesterIsCeo never routes to CEO even when ceoCanDecideFires=true", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    saveGovernanceConfig(db, "c1", {
      ...DEFAULT_GOVERNANCE_CONFIG,
      policies: {
        ...DEFAULT_GOVERNANCE_CONFIG.policies,
        ceoCanDecideFires: true,
      },
    });
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "ceo1",
      kind: "manager_request",
      payload: { topic: "fire", summary: "Self-fire", thread_id: "th-ceo-fire" },
    });
    const route = routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "manager_request",
      reason: "fire request",
      requesterIsCeo: true,
      requesterName: "CEO",
      summary: "Self-fire",
      managerTopic: "fire",
    });
    // Rule 2 wins: requesterIsCeo → user
    expect(route).toBe("user");
    expect(repo.getById(apv.id)?.routedTo).toBe("user");
  });

  it("armBouncesOnBoot fires immediately for approvals past TTL at boot", () => {
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    saveGovernanceConfig(db, "c1", {
      ...DEFAULT_GOVERNANCE_CONFIG,
      policies: {
        ...DEFAULT_GOVERNANCE_CONFIG.policies,
        bouncedToCeoTtlHours: 4,
      },
    });
    const repo = createApprovalsRepository(db);
    // Insert an approval that was created 5 hours ago and is stuck in user inbox
    const fiveHoursAgo = Date.now() - 5 * 60 * 60_000;
    db.prepare(
      `INSERT INTO approvals (id, agent_id, kind, payload_json, status, routed_to, bounce_count, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'user', 0, ?)`,
    ).run("apv_boot_test", "bot1", "tool_call", '{"tool_name":"Write"}', fiveHoursAgo);

    armBouncesOnBoot(db, ["c1"]);

    const updated = repo.getById("apv_boot_test");
    expect(updated?.routedTo).toBe("ceo");
    expect(updated?.bounceCount).toBe(1);
  });
});

describe("routeAndDispatch — coalescing integration (piece #5)", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });
  afterEach(() => {
    __resetApprovalEngine();
    vi.useRealTimers();
  });

  it("a single non-destructive CEO-routed approval waits 60s before waking the CEO", () => {
    vi.useFakeTimers();
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Read", tool_input: {}, tool_use_id: "tu-coal-1" },
    });

    routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Read file",
      toolName: "Read",
    });

    // Immediately after enqueue: routed to CEO but NO wake yet
    expect(repo.getById(apv.id)?.routedTo).toBe("ceo");
    expect((bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    vi.advanceTimersByTime(60_000);
    // After the window: CEO woken exactly once
    expect((bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("two non-destructive approvals in the same window batch into ONE CEO wake", () => {
    vi.useFakeTimers();
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const a1 = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Read", tool_input: {}, tool_use_id: "tu-coal-2a" },
    });
    const a2 = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Read", tool_input: {}, tool_use_id: "tu-coal-2b" },
    });

    routeAndDispatch({
      approvalId: a1.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "1",
      toolName: "Read",
    });
    vi.advanceTimersByTime(30_000);
    routeAndDispatch({
      approvalId: a2.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "2",
      toolName: "Read",
    });
    vi.advanceTimersByTime(30_000);

    // ONE wake covering both
    expect((bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const wakeContent = (bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as string;
    expect(wakeContent).toContain(a1.id);
    expect(wakeContent).toContain(a2.id);
    expect(wakeContent).toContain("decide_batch");

    // Follower is marked with coalesced_with pointing at the head
    expect(repo.getById(a2.id)?.coalescedWith).toBe(a1.id);
    expect(repo.getById(a1.id)?.coalescedWith).toBeNull();
  });

  it("a destructive arrival flushes the window immediately", () => {
    vi.useFakeTimers();
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const benign = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Read", tool_input: {}, tool_use_id: "tu-coal-3a" },
    });
    const bashCall = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "tu-coal-3b" },
    });

    routeAndDispatch({
      approvalId: benign.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Read",
      toolName: "Read",
    });
    routeAndDispatch({
      approvalId: bashCall.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "Bash ls",
      toolName: "Bash",
    });

    // Destructive collapsed the window — wake fires immediately, NO 60s wait
    expect((bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const wakeContent = (bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as string;
    expect(wakeContent).toContain(benign.id);
    expect(wakeContent).toContain(bashCall.id);
  });

  it("__resetApprovalEngine cancels pending coalescer timers", () => {
    vi.useFakeTimers();
    const bridge = makeBridge(db);
    setApprovalEngineBridge(bridge);
    const repo = createApprovalsRepository(db);
    const apv = repo.create({
      agentId: "bot1",
      kind: "tool_call",
      payload: { tool_name: "Read", tool_input: {}, tool_use_id: "tu-coal-4" },
    });

    routeAndDispatch({
      approvalId: apv.id,
      companyId: "c1",
      kind: "tool_call",
      reason: "",
      requesterIsCeo: false,
      requesterName: "Bot",
      summary: "x",
      toolName: "Read",
    });

    __resetApprovalEngine();
    vi.advanceTimersByTime(60_000);
    expect((bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
