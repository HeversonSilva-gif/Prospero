// C4 + I10 (audit 2026-06-04, Pillar 8 genesis) — boot recovery for genesis /
// plan artifacts. The events-watcher discards boot-time event files
// (cleanupOrphans + ignoreInitial), so a crash between insert(status=critiquing)
// and the critique leaves a business/org/goal plan orphaned: hidden from
// card/banner/review and (for goal plans) the goal stuck `planning`. There is a
// boot-reconciler for goals/agents but none for plan artifacts.
//
// These two pure scan helpers are extracted from the orchestrator's boot block
// so they are unit-testable without the whole IPC closure:
//   - scanCritiquingPlans: finds every `critiquing` row at boot and re-drives the
//     same handler the live event would (the watcher already cleaned the event
//     file, so any `critiquing` row at boot is genuinely stranded).
//   - scanApprovedBusinessWithoutTeam: a company with an approved business plan
//     but no team and no org plan → re-deliver the propose-the-team message.

import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { createOrgPlansRepository } from "../agents/org-plans-repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalPlansRepository } from "../goals/plans-repository.js";
import { scanCritiquingPlans, scanApprovedBusinessWithoutTeam } from "./orchestrator-handlers.js";

let db: Database.Database;

const seedCompany = (id: string, name = "Novo negócio") =>
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?,?,0)").run(id, name);

const seedAgent = (
  id: string,
  companyId: string,
  role: string,
  opts: { templateId?: string | null; terminated?: boolean } = {},
) =>
  db
    .prepare(
      `INSERT INTO agents
         (id, company_id, name, role, template_id, system_prompt, capabilities_json,
          allowed_projects_json, mode, always_on, status, model, adapter_name,
          created_at, updated_at, terminated_at)
       VALUES (?,?,?,?,?,'','[]','[]','supervised',0,'idle','claude-sonnet-4-6',
               'claude-oauth-local',0,0,?)`,
    )
    .run(
      id,
      companyId,
      role.toUpperCase(),
      role,
      opts.templateId ?? null,
      opts.terminated === true ? 1 : null,
    );

const seedBusinessPlan = (companyId: string, agentId: string) =>
  createBusinessPlansRepository(db).insert({
    companyId,
    proposedByAgentId: agentId,
    concept: "A SaaS recipe assistant.",
    monetization: ["R$9/mo"],
    marketing: { initialChannel: "x", tactics: ["threads"], laterChannels: "later" },
    identity: { name: "Cozinha de 15", voice: "friendly", proposedXHandle: "@c15" },
    dropped: [],
  });

const seedOrgPlan = (companyId: string, agentId: string) =>
  createOrgPlansRepository(db).insert({
    companyId,
    proposedByAgentId: agentId,
    summary: "two roles",
    roles: [
      {
        index: 0,
        name: "Engineer",
        description: "builds",
        charter: "Build it.",
        model: "sonnet-4",
        capabilities: [],
        icon: null,
      },
    ],
    agents: [
      { index: 0, name: "Eng", roleIndex: 0, reportsToIndex: "CEO", rationale: "needs an eng" },
    ],
  });

const seedGoalWithPlan = (companyId: string, agentId: string) => {
  const goalsRepo = createGoalsRepository(db);
  const goal = goalsRepo.create({
    companyId,
    title: "Ship v1",
    description: "the first release",
  });
  goalsRepo.updateStatus(goal.id, "planning");
  const plansRepo = createGoalPlansRepository(db);
  const plan = plansRepo.insert({
    goalId: goal.id,
    version: 1,
    proposedByAgentId: agentId,
    summary: "do the work",
    agentsToHire: [],
    issuesToCreate: [
      {
        index: 0,
        title: "Issue 1",
        description: "do it",
        priority: "medium",
        assigneeIndex: "CEO",
        estimatedTokens: 1000,
        dependsOnIndexes: [],
        rationale: "needed for v1",
      },
    ],
    estimatedTotalTokens: null,
    estimatedDurationDays: null,
    estimatedCostCents: null,
    risks: [],
    status: "critiquing",
  });
  return { goalId: goal.id, planId: plan.id };
};

beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
});

describe("scanCritiquingPlans (C4)", () => {
  it("re-drives a business plan left in 'critiquing' at boot", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    const plan = seedBusinessPlan("c1", "ceo1"); // inserts as 'critiquing'
    expect(plan.status).toBe("critiquing");

    const redriveBusinessPlan = vi.fn();
    const out = scanCritiquingPlans(db, {
      redriveBusinessPlan,
      redriveOrgPlan: vi.fn(),
      redriveGoalPlan: vi.fn(),
    });
    expect(redriveBusinessPlan).toHaveBeenCalledWith(plan.id, "c1");
    expect(out.business).toEqual([plan.id]);
  });

  it("re-drives an org plan left in 'critiquing' at boot", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    const plan = seedOrgPlan("c1", "ceo1"); // inserts as 'critiquing'
    expect(plan.status).toBe("critiquing");

    const redriveOrgPlan = vi.fn();
    const out = scanCritiquingPlans(db, {
      redriveBusinessPlan: vi.fn(),
      redriveOrgPlan,
      redriveGoalPlan: vi.fn(),
    });
    expect(redriveOrgPlan).toHaveBeenCalledWith(plan.id, "c1");
    expect(out.org).toEqual([plan.id]);
  });

  it("re-drives a goal plan left in 'critiquing' at boot (passes goalId + planId)", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    const { goalId, planId } = seedGoalWithPlan("c1", "ceo1");

    const redriveGoalPlan = vi.fn();
    const out = scanCritiquingPlans(db, {
      redriveBusinessPlan: vi.fn(),
      redriveOrgPlan: vi.fn(),
      redriveGoalPlan,
    });
    expect(redriveGoalPlan).toHaveBeenCalledWith(goalId, planId);
    expect(out.goal).toEqual([planId]);
  });

  it("ignores plans already past 'critiquing' (proposed/approved)", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    const repo = createBusinessPlansRepository(db);
    const plan = seedBusinessPlan("c1", "ceo1");
    repo.markProposed(plan.id); // now 'proposed'

    const redriveBusinessPlan = vi.fn();
    const out = scanCritiquingPlans(db, {
      redriveBusinessPlan,
      redriveOrgPlan: vi.fn(),
      redriveGoalPlan: vi.fn(),
    });
    expect(redriveBusinessPlan).not.toHaveBeenCalled();
    expect(out.business).toEqual([]);
  });

  it("a re-drive throwing does not abort the scan (fail-soft per-row)", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    const b = seedBusinessPlan("c1", "ceo1");
    const o = seedOrgPlan("c1", "ceo1");

    const redriveOrgPlan = vi.fn();
    expect(() =>
      scanCritiquingPlans(db, {
        redriveBusinessPlan: () => {
          throw new Error("boom");
        },
        redriveOrgPlan,
        redriveGoalPlan: vi.fn(),
      }),
    ).not.toThrow();
    // The org plan re-drive still ran despite the business re-drive throwing.
    expect(redriveOrgPlan).toHaveBeenCalledWith(o.id, "c1");
    void b;
  });
});

describe("scanApprovedBusinessWithoutTeam (I10)", () => {
  it("re-delivers the propose-team message when an approved business has no team", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    const repo = createBusinessPlansRepository(db);
    const plan = seedBusinessPlan("c1", "ceo1");
    repo.markProposed(plan.id);
    repo.markApproved(plan.id);

    const deliverSystemMessage = vi.fn();
    const out = scanApprovedBusinessWithoutTeam(db, { deliverSystemMessage });
    expect(deliverSystemMessage).toHaveBeenCalledTimes(1);
    const [agentId, text] = deliverSystemMessage.mock.calls[0]! as [string, string];
    expect(agentId).toBe("ceo1");
    expect(text).toContain("submit_org_plan");
    expect(out).toEqual(["c1"]);
  });

  it("does nothing when the company already has a non-CEO agent (team exists)", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    seedAgent("eng1", "c1", "engineer");
    const repo = createBusinessPlansRepository(db);
    const plan = seedBusinessPlan("c1", "ceo1");
    repo.markProposed(plan.id);
    repo.markApproved(plan.id);

    const deliverSystemMessage = vi.fn();
    const out = scanApprovedBusinessWithoutTeam(db, { deliverSystemMessage });
    expect(deliverSystemMessage).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("does nothing when an org plan already exists (proposed/critiquing/approved)", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    const bp = createBusinessPlansRepository(db);
    const plan = seedBusinessPlan("c1", "ceo1");
    bp.markProposed(plan.id);
    bp.markApproved(plan.id);
    seedOrgPlan("c1", "ceo1"); // a 'critiquing' org plan is in flight

    const deliverSystemMessage = vi.fn();
    const out = scanApprovedBusinessWithoutTeam(db, { deliverSystemMessage });
    expect(deliverSystemMessage).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("does nothing when the business plan is not approved", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    const repo = createBusinessPlansRepository(db);
    const plan = seedBusinessPlan("c1", "ceo1");
    repo.markProposed(plan.id); // proposed, not approved

    const deliverSystemMessage = vi.fn();
    const out = scanApprovedBusinessWithoutTeam(db, { deliverSystemMessage });
    expect(deliverSystemMessage).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("treats a terminated worker as no team (re-delivers)", () => {
    seedCompany("c1");
    seedAgent("ceo1", "c1", "ceo");
    seedAgent("eng1", "c1", "engineer", { terminated: true });
    const repo = createBusinessPlansRepository(db);
    const plan = seedBusinessPlan("c1", "ceo1");
    repo.markProposed(plan.id);
    repo.markApproved(plan.id);

    const deliverSystemMessage = vi.fn();
    const out = scanApprovedBusinessWithoutTeam(db, { deliverSystemMessage });
    expect(deliverSystemMessage).toHaveBeenCalledTimes(1);
    expect(out).toEqual(["c1"]);
  });
});
