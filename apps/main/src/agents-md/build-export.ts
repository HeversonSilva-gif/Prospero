import type Database from "better-sqlite3";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import type { AgentsMdAgent, AgentsMdPayload } from "./schema.js";

// PR-F.2.2: collect a company's projects + live agents into AGENTS.md shape.
// reports_to is emitted as the parent agent's NAME (not id) so the file is
// human-readable and re-importable without rewriting ids. Archived projects
// and terminated agents are filtered out.

export const buildExportPayload = (db: Database.Database, companyId: string): AgentsMdPayload => {
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
  const roleIdToName = new Map(
    createRoleTemplatesRepository(db)
      .listAll()
      .map((r) => [r.id, r.name.toLowerCase()]),
  );

  const agents: AgentsMdAgent[] = liveAgents.map((a) => {
    const out: AgentsMdAgent = {
      name: a.name,
      role: roleIdToName.get(a.role) ?? a.role,
    };
    if (a.model !== "") out.model = a.model;
    if (a.skills.length > 0) out.skills = a.skills;
    const parentName = a.reportsTo !== null ? idToName.get(a.reportsTo) : undefined;
    if (parentName !== undefined) out.reports_to = parentName;
    return out;
  });

  return { company: company.name, projects, agents };
};
