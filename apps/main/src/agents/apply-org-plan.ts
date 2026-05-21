import type Database from "better-sqlite3";
import {
  isCeoAgent,
  type ApplyOrgPlanResult,
  type ProposedAgent,
  type ProposedRole,
} from "@prospero/shared";
import { tryGetRecorder } from "../activity/index.js";
import { createAgentsRepository } from "./repository.js";
import { createRoleTemplatesRepository } from "./role-templates-repository.js";
import { createOrgPlansRepository } from "./org-plans-repository.js";
import { writeCharter } from "./role-charter-store.js";

export type ApplyOrgPlanOptions = {
  includeRoleIndexes?: Set<number>;
  includeAgentIndexes?: Set<number>;
};

const filterByIndex = <T extends { index: number }>(items: T[], include?: Set<number>): T[] =>
  include === undefined ? items : items.filter((i) => include.has(i.index));

// Orders agents so a parent is always created before a child (reportsTo points
// at an already-created agent). "CEO" parents resolve to the existing company
// CEO and impose no ordering constraint.
const topoSortAgents = (agents: ProposedAgent[]): ProposedAgent[] => {
  const byIndex = new Map(agents.map((a) => [a.index, a]));
  const visited = new Set<number>();
  const out: ProposedAgent[] = [];
  const visit = (a: ProposedAgent): void => {
    if (visited.has(a.index)) return;
    visited.add(a.index);
    if (a.reportsToIndex !== "CEO") {
      const parent = byIndex.get(a.reportsToIndex);
      if (parent) visit(parent);
    }
    out.push(a);
  };
  for (const a of agents) visit(a);
  return out;
};

// Applies an approved org plan in one transaction: pass 1 creates the roles
// (role_templates row + charter file on disk); pass 2 creates the agents in
// their roles and wires the reporting hierarchy. Purely additive.
export const applyOrgPlan = (
  db: Database.Database,
  userDataDir: string,
  orgPlanId: string,
  options: ApplyOrgPlanOptions = {},
): ApplyOrgPlanResult => {
  // The recorder is passed to the agents repo so agent creation still emits the
  // standard `agent.hired` activity events.
  const orgPlansRepo = createOrgPlansRepository(db);
  const roleRepo = createRoleTemplatesRepository(db);
  const agentsRepo = createAgentsRepository(db, tryGetRecorder());

  try {
    return db.transaction((): ApplyOrgPlanResult => {
      const plan = orgPlansRepo.getById(orgPlanId);
      if (plan === null || plan.status !== "proposed") {
        throw Object.assign(new Error(`org plan ${orgPlanId} is not in 'proposed' state`), {
          step: "load-plan",
        });
      }

      const includedRoles: ProposedRole[] = filterByIndex(plan.roles, options.includeRoleIndexes);
      const includedAgents: ProposedAgent[] = filterByIndex(
        plan.agents,
        options.includeAgentIndexes,
      );

      const ceo = agentsRepo.listByCompany(plan.companyId).find(isCeoAgent);
      if (ceo === undefined) {
        throw Object.assign(new Error(`no CEO for company ${plan.companyId}`), {
          step: "lookup-ceo",
        });
      }

      // Pass 1 — roles.
      const roleIndexToId = new Map<number, string>();
      const createdRoleIds: string[] = [];
      for (const role of includedRoles) {
        const created = roleRepo.create({
          name: role.name,
          description: role.description,
          icon: role.icon,
          defaultModel: role.model,
          defaultCapabilities: role.capabilities,
        });
        writeCharter(userDataDir, created.id, role.charter);
        roleIndexToId.set(role.index, created.id);
        createdRoleIds.push(created.id);
      }

      // Pass 2 — agents, parents before children.
      const agentIndexToId = new Map<number, string>();
      const hiredAgentIds: string[] = [];
      for (const agent of topoSortAgents(includedAgents)) {
        const roleId = roleIndexToId.get(agent.roleIndex);
        if (roleId === undefined) {
          throw Object.assign(
            new Error(
              `agent index ${agent.index} references role index ${agent.roleIndex}, which was not included`,
            ),
            { step: "resolve-role" },
          );
        }
        const role = includedRoles.find((r) => r.index === agent.roleIndex)!;

        let reportsToId: string;
        if (agent.reportsToIndex === "CEO") {
          reportsToId = ceo.id;
        } else {
          const resolved = agentIndexToId.get(agent.reportsToIndex);
          if (resolved === undefined) {
            throw Object.assign(
              new Error(
                `agent index ${agent.index} reports to agent index ${agent.reportsToIndex}, which was not included`,
              ),
              { step: "resolve-reports-to" },
            );
          }
          reportsToId = resolved;
        }

        const created = agentsRepo.create({
          companyId: plan.companyId,
          name: agent.name,
          role: role.name,
          systemPrompt: "",
          mode: "supervised",
          alwaysOn: false,
          model: role.model,
          capabilities: role.capabilities,
          templateId: roleId,
        });
        agentsRepo.setReportsTo(created.id, reportsToId);
        agentIndexToId.set(agent.index, created.id);
        hiredAgentIds.push(created.id);
      }

      orgPlansRepo.markApproved(orgPlanId);
      return { ok: true, createdRoleIds, hiredAgentIds };
    })();
  } catch (e) {
    const err = e as Error & { step?: string };
    return { ok: false, error: err.message, failedAtStep: err.step ?? "unknown" };
  }
};
