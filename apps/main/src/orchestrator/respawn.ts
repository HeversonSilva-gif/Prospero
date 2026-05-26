import type Database from "better-sqlite3";
import { app } from "electron";
import { createAgentsRepository } from "../agents/repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { buildMemoryBlock } from "./system-prompt-memory.js";
import { buildTelosBlock } from "./system-prompt-telos.js";
import { buildProjectContextBlock } from "./system-prompt-project-context.js";
import { composeInstructions } from "../agents/instruction-bundle.js";
import { resolveAdapterCredentials } from "./adapter-credentials.js";
import { loadDecryptedToken } from "../auth/token-storage.js";
import { loadDecryptedApiKey } from "../auth/api-key-storage.js";
import { databasePath } from "../db/path.js";
import { getPermissionsDir } from "../security/permissions-dir.js";
import { ensureAdapter, type AdapterCallbacks, type EnsureAdapterOptions } from "./lifecycle.js";

/**
 * Dependencies the respawn helper captures once at orchestrator init. Kept as a
 * named-fields object so future tasks can add fields (e.g. `pendingTurnByAgent`,
 * broadcast callbacks for the recovery module) without breaking call sites.
 */
export type RespawnDeps = {
  db: Database.Database;
  eventsDir: string;
  buildCallbacks: (agentId: string) => AdapterCallbacks;
};

/** Re-spawns the adapter for `agentId`. No-op if the agent row is gone. */
export type RespawnFn = (agentId: string) => Promise<void>;

/**
 * Builds the SpawnContext the same way `orchestrator-handlers.ts` did inline
 * (M11 memory block, M12 instruction bundle, M13 TELOS, project-context digest,
 * credentials from token storage), then calls `ensureAdapter`. Pure refactor of
 * the existing inline block — no behavior change. The recovery module (added
 * in later tasks of the token-recovery v0.1.17 hotfix) calls this to re-spawn
 * an agent after a fresh OAuth token is on disk.
 */
export const createRespawnFn = (deps: RespawnDeps): RespawnFn => {
  return async (agentId: string): Promise<void> => {
    const agents = createAgentsRepository(deps.db);
    const agent = agents.getById(agentId);
    if (agent === null) return;

    const adapterName = agent.adapterName ?? "claude-oauth-local";
    const { oauthToken, apiKey } = resolveAdapterCredentials(adapterName, {
      loadOauthToken: () => loadDecryptedToken(deps.db),
      loadApiKey: () => loadDecryptedApiKey(deps.db),
    });

    // M11: assemble the memory & skills system-prompt block host-side (DB +
    // userData access live here, not in build-args) and thread it through.
    const memoryBlock = buildMemoryBlock({
      memoriesRepo: createMemoriesRepository(deps.db),
      skillsRepo: createSkillsRepository(deps.db),
      userDataDir: app.getPath("userData"),
      companyId: agent.companyId,
      agentId: agent.id,
      role: agent.role,
    });

    // M12 PR-C: assemble the agent's instruction bundle (charter + extras) from
    // disk — same host-side pattern as buildMemoryBlock.
    const instructionsBlock = composeInstructions(app.getPath("userData"), agent);

    // M13 PR-C: assemble the TELOS system-prompt block host-side.
    const telosBlock = buildTelosBlock({
      userDataDir: app.getPath("userData"),
      companyId: agent.companyId,
      agentRole: agent.role,
      agentTemplateId: agent.templateId,
    });

    // Memória de Contexto de Projeto: inject the per-project digest map when the
    // agent is scoped to exactly one project (so the digest target is unambiguous).
    let projectContextBlock: string | undefined;
    const ctxProjectIds = agent.allowedProjects;
    if (ctxProjectIds.length === 1) {
      const proj = createProjectsRepository(deps.db).getById(ctxProjectIds[0]!);
      if (proj !== null) {
        projectContextBlock = buildProjectContextBlock({
          userDataDir: app.getPath("userData"),
          companyId: agent.companyId,
          projectId: proj.id,
          projectPath: proj.path,
        });
      }
    }

    const opts: EnsureAdapterOptions = {
      agent,
      ...(oauthToken !== undefined ? { oauthToken } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
      userDataDir: app.getPath("userData"),
      dbPath: databasePath(),
      permissionsDir: getPermissionsDir(app.getPath("userData")),
      eventsDir: deps.eventsDir,
      ...(memoryBlock !== undefined ? { memoryBlock } : {}),
      ...(telosBlock !== undefined ? { telosBlock } : {}),
      ...(projectContextBlock !== undefined ? { projectContextBlock } : {}),
      instructionsBlock,
    };

    await ensureAdapter(opts, deps.buildCallbacks(agentId));
  };
};
