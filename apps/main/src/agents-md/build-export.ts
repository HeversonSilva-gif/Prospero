import type Database from "better-sqlite3";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import { readCharter } from "../agents/role-charter-store.js";
import type { AgentsMdAgent, AgentsMdPayload, AgentsMdRole } from "./schema.js";

// PR-F.2.2 / M12 PR-D4: collect a company's projects, the roles its live agents
// use (charter included), and the agents themselves into AGENTS.md shape.
// reports_to is emitted as the parent agent's NAME so the file is human-readable
// and re-importable. Archived projects and terminated agents are filtered out.

export const buildExportPayload = (
  db: Database.Database,
  companyId: string,
  userDataDir: string,
): AgentsMdPayload => {
  const company = createCompaniesRepository(db)
    .list()
    .find((c) => c.id === companyId);
  if (company === undefined) {
    throw new Error(`Company ${companyId} not found`);
  }

  const projects = createProjectsRepository(db)
    .listByCompany(companyId)
    .filter((p) => p.archivedAt === null)
    .map((p) => ({ name: p.name, path: p.path }));

  const allAgents = createAgentsRepository(db).listByCompany(companyId);
  const liveAgents = allAgents.filter((a) => a.terminatedAt === null);
  const idToName = new Map(liveAgents.map((a) => [a.id, a.name]));

  const roleRepo = createRoleTemplatesRepository(db);
  const roleIdToName = new Map(roleRepo.listAll().map((r) => [r.id, r.name.toLowerCase()]));

  // The distinct roles the live agents actually fill — keyed by templateId, the
  // reliable role-id field. A null templateId (legacy agent) is skipped.
  const usedRoleIds = [
    ...new Set(
      liveAgents.map((a) => a.templateId).filter((id): id is string => id !== null && id !== ""),
    ),
  ];
  const roles: AgentsMdRole[] = [];
  for (const roleId of usedRoleIds) {
    const role = roleRepo.getById(roleId);
    if (role === null) continue;
    const out: AgentsMdRole = { name: role.name };
    if (role.description !== "") out.description = role.description;
    if (role.defaultModel !== "") out.model = role.defaultModel;
    if (role.defaultCapabilities.length > 0) out.capabilities = role.defaultCapabilities;
    if (role.icon !== null) out.icon = role.icon;
    out.charter = readCharter(userDataDir, role.id);
    roles.push(out);
  }

  const agents: AgentsMdAgent[] = liveAgents.map((a) => {
    const out: AgentsMdAgent = {
      name: a.name,
      role: roleIdToName.get(a.role) ?? a.role,
    };
    if (a.model !== "") out.model = a.model;
    if (a.capabilities.length > 0) out.capabilities = a.capabilities;
    const parentName = a.reportsTo !== null ? idToName.get(a.reportsTo) : undefined;
    if (parentName !== undefined) out.reports_to = parentName;
    return out;
  });

  return { company: company.name, projects, roles, agents };
};
