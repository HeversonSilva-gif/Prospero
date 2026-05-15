import type Database from "better-sqlite3";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import type { AgentsMdPayload, ConflictMode, HireSummary } from "./schema.js";

// PR-F.2.2: import an AGENTS.md payload into an existing company.
//   * Projects keyed by path: a row with the same (company_id, path) is skipped.
//   * Agents keyed by name within the company: existing name → consult
//     conflictModes[name]. 'skip' leaves it; 'replace' terminates the old one
//     (we never DELETE — preserves history) and creates a fresh row.
//   * reports_to wired in a second pass by looking up the freshly-created name.

export type HireOptions = {
  companyId: string;
  conflictModes: Record<string, ConflictMode>;
};

const findRoleId = (
  db: Database.Database,
  roleHint: string,
): { id: string; defaultModel: string; defaultCapabilities: string[] } | null => {
  const roles = createRoleTemplatesRepository(db).listAll();
  const lower = roleHint.toLowerCase();
  const match =
    roles.find((r) => r.id.toLowerCase() === lower) ??
    roles.find((r) => r.name.toLowerCase() === lower) ??
    roles.find((r) => r.id.toLowerCase() === `role-${lower}`);
  if (match === undefined) return null;
  return {
    id: match.id,
    defaultModel: match.defaultModel,
    defaultCapabilities: match.defaultCapabilities,
  };
};

export const hireFromAgentsMd = (
  db: Database.Database,
  payload: AgentsMdPayload,
  opts: HireOptions,
): HireSummary => {
  const summary: HireSummary = {
    companyId: opts.companyId,
    created: { projects: 0, agents: 0 },
    skipped: { projects: [], agents: [] },
    replaced: { agents: [] },
    warnings: [],
  };

  const projectsRepo = createProjectsRepository(db);
  const agentsRepo = createAgentsRepository(db);

  const existingProjects = projectsRepo.listByCompany(opts.companyId);
  const existingPaths = new Set(existingProjects.map((p) => p.path));
  for (const p of payload.projects) {
    if (existingPaths.has(p.path)) {
      summary.skipped.projects.push(p.name);
      continue;
    }
    projectsRepo.create({
      companyId: opts.companyId,
      name: p.name,
      path: p.path,
      color: "#6366f1",
    });
    summary.created.projects += 1;
  }

  const existingAgents = agentsRepo.listByCompany(opts.companyId);
  const existingByName = new Map(existingAgents.map((a) => [a.name, a]));
  const createdByName = new Map<string, string>();

  for (const a of payload.agents) {
    const role = findRoleId(db, a.role);
    if (role === null) {
      summary.warnings.push(`agent "${a.name}": unknown role "${a.role}" — skipped`);
      summary.skipped.agents.push(a.name);
      continue;
    }

    const conflict = existingByName.get(a.name);
    if (conflict !== undefined && conflict.terminatedAt === null) {
      const mode = opts.conflictModes[a.name] ?? "skip";
      if (mode === "skip") {
        summary.skipped.agents.push(a.name);
        // Map name to existing id so reports_to wiring can still target it.
        createdByName.set(a.name, conflict.id);
        continue;
      }
      agentsRepo.terminate(conflict.id, "replaced by agents.md import");
      summary.replaced.agents.push(a.name);
    }

    const created = agentsRepo.create({
      companyId: opts.companyId,
      name: a.name,
      role: role.id,
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: role.id,
      model: a.model ?? role.defaultModel,
      capabilities: a.capabilities ?? role.defaultCapabilities,
      actor: { kind: "user" },
    });
    summary.created.agents += 1;
    createdByName.set(a.name, created.id);
  }

  for (const a of payload.agents) {
    if (a.reports_to === undefined || a.reports_to === "") continue;
    const childId = createdByName.get(a.name);
    if (childId === undefined) continue;
    const parentId = createdByName.get(a.reports_to);
    if (parentId === undefined) {
      summary.warnings.push(
        `agent "${a.name}": reports_to "${a.reports_to}" not found in payload — left unset`,
      );
      continue;
    }
    agentsRepo.setReportsTo(childId, parentId);
  }

  return summary;
};
