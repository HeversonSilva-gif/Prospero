import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentsRepository, type CreateAgentInput } from "./repository.js";

const sendSpy = vi.fn();
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: sendSpy } }],
  },
}));

const __dirname = dirname(fileURLToPath(import.meta.url));

const setupDb = (): Database.Database => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'C', 0)").run();
  return db;
};

const baseInput = (over: Partial<CreateAgentInput> = {}): CreateAgentInput => ({
  companyId: "c1",
  name: "A",
  role: "r",
  systemPrompt: "p",
  mode: "supervised",
  alwaysOn: false,
  model: "claude-sonnet-4-6",
  capabilities: ["chat"],
  ...over,
});

describe("setModel", () => {
  it("updates the agent model column", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput());
    repo.setModel(agent.id, "claude-opus-4-7");
    expect(repo.getById(agent.id)?.model).toBe("claude-opus-4-7");
  });
});

describe("create — adapter_name", () => {
  it("defaults to claude-oauth-local", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(a.adapterName).toBe("claude-oauth-local");
  });

  it("respects explicit adapterName input", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput({ adapterName: "claude-api-key-local" }));
    expect(a.adapterName).toBe("claude-api-key-local");
  });
});

describe("setSystemPrompt", () => {
  it("updates the agent system prompt", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput({ systemPrompt: "old" }));
    repo.setSystemPrompt(agent.id, "new prompt");
    expect(repo.getById(agent.id)?.systemPrompt).toBe("new prompt");
  });
});

const seedRole = (
  db: Database.Database,
  id: string,
  model: string,
  capabilities: string[],
): void => {
  db.prepare(
    `INSERT OR REPLACE INTO role_templates (id, name, description, default_system_prompt, default_capabilities_json, default_model, icon)
     VALUES (?, ?, '', 'p', ?, ?, NULL)`,
  ).run(id, id, JSON.stringify(capabilities), model);
};

describe("setRole", () => {
  it("atomically updates template_id, capabilities, and model from role_template", () => {
    const db = setupDb();
    seedRole(db, "role-engineer", "claude-sonnet-4-6", ["shell", "chat"]);
    const repo = createAgentsRepository(db);
    const agent = repo.create(
      baseInput({ model: "claude-haiku-4-5-20251001", capabilities: ["chat"] }),
    );
    repo.setRole(agent.id, "role-engineer");
    const updated = repo.getById(agent.id);
    expect(updated?.templateId).toBe("role-engineer");
    expect(updated?.capabilities).toEqual(["shell", "chat"]);
    expect(updated?.model).toBe("claude-sonnet-4-6");
  });

  it("does NOT overwrite model when preserveModel=true", () => {
    const db = setupDb();
    seedRole(db, "role-engineer", "claude-sonnet-4-6", ["shell"]);
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput({ model: "claude-opus-4-7", capabilities: [] }));
    repo.setRole(agent.id, "role-engineer", { preserveModel: true });
    expect(repo.getById(agent.id)?.model).toBe("claude-opus-4-7");
    expect(repo.getById(agent.id)?.capabilities).toEqual(["shell"]);
  });

  it("throws when role_template_id does not exist", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const agent = repo.create(baseInput());
    expect(() => repo.setRole(agent.id, "role-nonexistent")).toThrow();
  });
});

describe("setReportsTo", () => {
  it("updates reports_to to a new parent", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const ceo = repo.create(baseInput({ name: "CEO" }));
    const eng = repo.create(baseInput({ name: "Eng" }));
    repo.setReportsTo(eng.id, ceo.id);
    expect(repo.getById(eng.id)?.reportsTo).toBe(ceo.id);
  });

  it("accepts null parent (detach to root)", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const ceo = repo.create(baseInput({ name: "CEO" }));
    const eng = repo.create(baseInput({ name: "Eng" }));
    repo.setReportsTo(eng.id, ceo.id);
    repo.setReportsTo(eng.id, null);
    expect(repo.getById(eng.id)?.reportsTo).toBeNull();
  });

  it("rejects self as parent", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(() => repo.setReportsTo(a.id, a.id)).toThrow(/cycle|self/i);
  });

  it("rejects a descendant as parent (cycle)", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const ceo = repo.create(baseInput({ name: "CEO" }));
    const eng = repo.create(baseInput({ name: "Eng" }));
    repo.setReportsTo(eng.id, ceo.id);
    expect(() => repo.setReportsTo(ceo.id, eng.id)).toThrow(/cycle/i);
  });
});

describe("budget + run policy", () => {
  it("new agents default to daily period, can_hire/can_assign true, null limits", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(a.budgetTokensLimit).toBeNull();
    expect(a.budgetUsdLimit).toBeNull();
    expect(a.budgetPeriod).toBe("daily");
    expect(a.canHire).toBe(true);
    expect(a.canAssign).toBe(true);
  });

  it("setBudget round-trips limits and period", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setBudget(a.id, { tokensLimit: 50_000, usdLimit: 1_200, period: "monthly" });
    const updated = repo.getById(a.id);
    expect(updated?.budgetTokensLimit).toBe(50_000);
    expect(updated?.budgetUsdLimit).toBe(1_200);
    expect(updated?.budgetPeriod).toBe("monthly");
  });

  it("setBudget accepts null limits (unset)", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setBudget(a.id, { tokensLimit: 10, usdLimit: 10, period: "daily" });
    repo.setBudget(a.id, { tokensLimit: null, usdLimit: null, period: "daily" });
    const updated = repo.getById(a.id);
    expect(updated?.budgetTokensLimit).toBeNull();
    expect(updated?.budgetUsdLimit).toBeNull();
  });

  it("setBudget rejects a non-positive token limit", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(() => repo.setBudget(a.id, { tokensLimit: 0, usdLimit: null, period: "daily" })).toThrow(
      /positive integer/i,
    );
  });

  it("setBudget rejects a non-positive usd limit", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(() => repo.setBudget(a.id, { tokensLimit: null, usdLimit: 0, period: "daily" })).toThrow(
      /positive integer/i,
    );
  });

  it("setPermissions round-trips can_hire/can_assign", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setPermissions(a.id, { canHire: false, canAssign: false });
    const updated = repo.getById(a.id);
    expect(updated?.canHire).toBe(false);
    expect(updated?.canAssign).toBe(false);
  });

  it("getBudgetState reflects setBudget and starts with a null warnedPeriod", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setBudget(a.id, { tokensLimit: 999, usdLimit: null, period: "monthly" });
    const state = repo.getBudgetState(a.id);
    expect(state).toEqual({
      tokensLimit: 999,
      usdLimit: null,
      period: "monthly",
      warnedPeriod: null,
      adapterName: "claude-oauth-local",
    });
  });

  it("setBudgetWarnedPeriod records the key; setBudget clears it", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setBudget(a.id, { tokensLimit: 999, usdLimit: null, period: "daily" });
    repo.setBudgetWarnedPeriod(a.id, "2026-05-18");
    expect(repo.getBudgetState(a.id)?.warnedPeriod).toBe("2026-05-18");
    repo.setBudget(a.id, { tokensLimit: 500, usdLimit: null, period: "daily" });
    expect(repo.getBudgetState(a.id)?.warnedPeriod).toBeNull();
  });

  it("getBudgetState returns null for an unknown agent", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    expect(repo.getBudgetState("nope")).toBeNull();
  });
});

describe("listErroredAgentIds", () => {
  it("returns ids of non-terminated 'error' agents only", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const now = Date.now();
    const insertAgent = (id: string, status: string, terminatedAt?: number) => {
      db.prepare(
        `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
         VALUES (?, 'c1', ?, 'tester', 'p', '[]', '[]', 'supervised', 0, ?, ?, ?)`,
      ).run(id, id, status, now, now);
      if (terminatedAt !== undefined) {
        db.prepare("UPDATE agents SET terminated_at = ? WHERE id = ?").run(terminatedAt, id);
      }
    };
    insertAgent("e1", "error");
    insertAgent("e2", "error");
    insertAgent("ok", "idle");
    insertAgent("busy", "working");
    insertAgent("term-error", "error", now); // error but terminated → excluded

    expect(repo.listErroredAgentIds().sort()).toEqual(["e1", "e2"]);
  });

  it("returns an empty array when no agent is in error", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    expect(repo.listErroredAgentIds()).toEqual([]);
  });
});

describe("resetStuckAgents", () => {
  it("resets error/working/thinking/waiting agents to idle; leaves paused, terminated, and already-idle alone; returns count reset", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);

    const now = Date.now();

    // Insert agents directly with explicit statuses to avoid going through create()
    // which always sets status='idle'.
    const insertAgent = (id: string, status: string, extra: Record<string, unknown> = {}) => {
      db.prepare(
        `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
         VALUES (?, 'c1', ?, 'tester', 'p', '[]', '[]', 'supervised', 0, ?, ?, ?)`,
      ).run(id, id, status, now, now);
      if (extra.paused_at !== undefined) {
        db.prepare("UPDATE agents SET paused_at = ? WHERE id = ?").run(extra.paused_at, id);
      }
      if (extra.terminated_at !== undefined) {
        db.prepare("UPDATE agents SET terminated_at = ? WHERE id = ?").run(extra.terminated_at, id);
      }
    };

    insertAgent("a-error", "error");
    insertAgent("a-working", "working");
    insertAgent("a-thinking", "thinking");
    insertAgent("a-waiting", "waiting");
    insertAgent("a-idle", "idle");
    insertAgent("a-paused", "paused", { paused_at: now });
    insertAgent("a-terminated", "working", { terminated_at: now }); // working but terminated_at set

    const count = repo.resetStuckAgents();

    expect(count).toBe(4); // error, working, thinking, waiting (non-terminated)

    expect(repo.getById("a-error")?.status).toBe("idle");
    expect(repo.getById("a-working")?.status).toBe("idle");
    expect(repo.getById("a-thinking")?.status).toBe("idle");
    expect(repo.getById("a-waiting")?.status).toBe("idle");
    expect(repo.getById("a-idle")?.status).toBe("idle");
    expect(repo.getById("a-paused")?.status).toBe("paused");
    // Terminated agent: status was 'working' but terminated_at set — must not be reset
    const terminated = repo.getById("a-terminated")!;
    expect(terminated.terminatedAt).not.toBeNull();
    // status stays as whatever it was (not reset, terminated_at is set)
    expect(terminated.status).not.toBe("idle"); // still 'working', untouched
  });
});

describe("clearStalePauseReasons", () => {
  it("clears pause_reason on non-paused rows; leaves paused and terminated alone", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const now = Date.now();
    const insertAgent = (
      id: string,
      status: string,
      pauseReason: string | null,
      terminatedAt: number | null = null,
    ) => {
      db.prepare(
        `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, pause_reason, terminated_at, created_at, updated_at)
         VALUES (?, 'c1', ?, 'tester', 'p', '[]', '[]', 'supervised', 0, ?, ?, ?, ?, ?)`,
      ).run(id, id, status, pauseReason, terminatedAt, now, now);
    };

    insertAgent("ghost-idle", "idle", "auth"); // the bug: idle + stale reason → clear
    insertAgent("ghost-waiting", "waiting", "auth"); // also stale → clear
    insertAgent("clean-idle", "idle", null); // nothing to do
    insertAgent("really-paused", "paused", "auth"); // legitimately paused → keep
    insertAgent("terminated", "idle", "auth", now); // terminated → leave alone

    const count = repo.clearStalePauseReasons();

    expect(count).toBe(2); // ghost-idle + ghost-waiting
    expect(repo.getById("ghost-idle")?.pauseReason).toBeNull();
    expect(repo.getById("ghost-waiting")?.pauseReason).toBeNull();
    expect(repo.getById("clean-idle")?.pauseReason).toBeNull();
    expect(repo.getById("really-paused")?.pauseReason).toBe("auth");
    expect(repo.getById("terminated")?.pauseReason).toBe("auth");
  });
});

describe("trust tier (M14 PR-A)", () => {
  it("rowToAgent reads trust_tier — defaults to novato for a fresh hire", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    expect(a.trustTier).toBe("novato");
  });

  it("setTrustTier persists the new tier and round-trips through getById", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    repo.setTrustTier(a.id, "confiavel");
    expect(repo.getById(a.id)?.trustTier).toBe("confiavel");
    repo.setTrustTier(a.id, "autonomo");
    expect(repo.getById(a.id)?.trustTier).toBe("autonomo");
  });

  it("setTrustTier broadcasts AGENT_EVENT with trust-tier-changed (M14 PR-D)", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a = repo.create(baseInput());
    sendSpy.mockClear();
    repo.setTrustTier(a.id, "confiavel");
    expect(sendSpy).toHaveBeenCalledWith(
      "agent:event",
      expect.objectContaining({
        kind: "trust-tier-changed",
        agentId: a.id,
        tier: "confiavel",
      }),
    );
  });
});

describe("listByPauseReason", () => {
  it("returns only agents paused with the given reason, excluding other reasons", () => {
    const db = setupDb();
    const repo = createAgentsRepository(db);
    const a1 = repo.create(baseInput({ name: "Agent1" }));
    const a2 = repo.create(baseInput({ name: "Agent2" }));
    repo.pause(a1.id, "rate_limited");
    repo.pause(a2.id, "budget_exceeded_daily");
    const results = repo.listByPauseReason("rate_limited");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(a1.id);
  });
});
