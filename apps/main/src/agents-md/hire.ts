import type Database from "better-sqlite3";
import { MODEL_ID_REGEX } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createRoleTemplatesRepository } from "../agents/role-templates-repository.js";
import { resolveModelPreset, MODEL_PRESETS } from "../agents/model-presets.js";
import { writeCharter } from "../agents/role-charter-store.js";
import type { AgentsMdPayload, ConflictMode, HireSummary } from "./schema.js";

// PR-F.2.2 / M12 PR-D4: import an AGENTS.md payload into an existing company.
//   * Roles keyed by name: a role whose name already exists is reused (skipped);
//     otherwise it is created and its charter (if any) written to disk.
//   * Projects keyed by path: a row with the same (company_id, path) is skipped.
//   * Agents keyed by name within the company: existing name → consult
//     conflictModes[name]. 'skip' leaves it; 'replace' terminates the old one
//     (we never DELETE — preserves history) and creates a fresh row.
//   * reports_to wired in a second pass by looking up the freshly-created name.

const DEFAULT_MODEL = "claude-sonnet-4-6";

// Audit 2026-06-03 Inteligência & Contexto M4: the AGENTS.md `model` field is
// untrusted free text (schema only enforces z.string()). Accept it only if it is
// a known preset alias (→ resolve to the real id) OR already a valid raw id
// (MODEL_ID_REGEX shape, which the rest of the system enforces before a
// shell-spawned --model). Anything else returns null so the caller falls back +
// warns instead of silently running resolveModelPreset's sonnet default (or
// spawning an injected string).
const resolveAndValidateModel = (raw: string): string | null => {
  const trimmed = raw.trim();
  if ((MODEL_PRESETS as readonly string[]).includes(trimmed)) return resolveModelPreset(trimmed);
  return MODEL_ID_REGEX.test(trimmed) ? trimmed : null;
};

export type HireOptions = {
  companyId: string;
  conflictModes: Record<string, ConflictMode>;
  userDataDir: string;
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
    created: { projects: 0, roles: 0, agents: 0 },
    skipped: { projects: [], roles: [], agents: [] },
    replaced: { agents: [] },
    warnings: [],
  };

  const projectsRepo = createProjectsRepository(db);
  const agentsRepo = createAgentsRepository(db);
  const roleRepo = createRoleTemplatesRepository(db);

  // Roles pass — create any role whose name is not already taken.
  const existingRoleNames = new Set(roleRepo.listAll().map((r) => r.name.toLowerCase()));
  for (const r of payload.roles ?? []) {
    if (existingRoleNames.has(r.name.toLowerCase())) {
      summary.skipped.roles.push(r.name);
      continue;
    }
    let roleModel = DEFAULT_MODEL;
    if (r.model !== undefined && r.model.trim() !== "") {
      const valid = resolveAndValidateModel(r.model);
      if (valid === null) {
        summary.warnings.push(
          `role "${r.name}": invalid model "${r.model}" — fell back to ${DEFAULT_MODEL}`,
        );
      } else {
        roleModel = valid;
      }
    }
    const created = roleRepo.create({
      name: r.name,
      description: r.description ?? "",
      icon: r.icon ?? null,
      defaultModel: roleModel,
      defaultCapabilities: r.capabilities ?? [],
    });
    if (r.charter !== undefined && r.charter.trim() !== "") {
      writeCharter(opts.userDataDir, created.id, r.charter);
    }
    existingRoleNames.add(r.name.toLowerCase());
    summary.created.roles += 1;
  }

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

    // M4: resolve + validate an explicit per-agent model (preset alias or raw
    // id); fall back to the role default on invalid input. role.defaultModel is
    // already a real id from the DB, so it needs no resolution.
    let agentModel = role.defaultModel;
    if (a.model !== undefined && a.model.trim() !== "") {
      const valid = resolveAndValidateModel(a.model);
      if (valid === null) {
        summary.warnings.push(
          `agent "${a.name}": invalid model "${a.model}" — fell back to ${role.defaultModel}`,
        );
      } else {
        agentModel = valid;
      }
    }

    const created = agentsRepo.create({
      companyId: opts.companyId,
      name: a.name,
      role: role.id,
      systemPrompt: "",
      mode: "supervised",
      alwaysOn: false,
      templateId: role.id,
      model: agentModel,
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
