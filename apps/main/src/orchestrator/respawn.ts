import type Database from "better-sqlite3";
import { app } from "electron";
import type { AgentAdapter } from "@prospero/shared";
import { createAgentsRepository } from "../agents/repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { buildMemoryBlock } from "./system-prompt-memory.js";
import { buildTelosBlock } from "./system-prompt-telos.js";
import { buildCapabilityBoundary } from "../agents/genesis/capability-boundary.js";
import { listConnectedChannels } from "../connections/connections-repository.js";
import {
  buildProjectContextBlock,
  buildAgentContextBlock,
} from "./system-prompt-project-context.js";
import { compactionTarget } from "../context/compaction-target.js";
import { composeInstructions } from "../agents/instruction-bundle.js";
import { resolveAdapterCredentials } from "./adapter-credentials.js";
import { loadDecryptedToken } from "../auth/token-storage.js";
import { loadDecryptedApiKey } from "../auth/api-key-storage.js";
import { databasePath } from "../db/path.js";
import { getPermissionsDir } from "../security/permissions-dir.js";
import { getAgentConfigDir } from "./util/paths.js";
import { sessionTranscriptExists } from "./adapters/claude-oauth-local/prepare-sandbox.js";
import { ensureAdapter, type AdapterCallbacks, type EnsureAdapterOptions } from "./lifecycle.js";

/**
 * Per-spawn mutable cell carrying the adapter for THIS spawn's callback
 * closures. `createRespawnFn` allocates a fresh cell per call and writes the
 * adapter into it once `ensureAdapter` resolves — BEFORE any callback (event
 * or exit) can fire — preserving the original `.then(a => thisSpawn = a)`
 * semantics. Each spawn's `onExit` closure reads its OWN cell to verify the
 * exit belongs to it (per-spawn isolation: a later spawn for the same agent
 * gets a different cell, so its capture doesn't fool the earlier closure).
 */
export type SpawnState = { adapter: AgentAdapter | null };

/**
 * Source-of-truth value type for `pendingTurnByAgent` (token-recovery v0.1.17,
 * extended in v0.1.18 to carry the originating message id so a respawn-driven
 * re-emit can re-resolve any attachments persisted alongside that message).
 * `messageId` is `null` for inter-agent / system-driven writes that don't
 * correspond to a row in `messages`.
 */
export type PendingTurn = { content: string; messageId: string | null };

/**
 * Dependencies the respawn helper captures once at orchestrator init. Kept as a
 * named-fields object so future tasks can add fields (e.g. `pendingTurnByAgent`,
 * broadcast callbacks for the recovery module) without breaking call sites.
 *
 * `buildCallbacks` MUST embed `spawnState` into the callback closures it
 * returns so `onExit` can read `spawnState.adapter` after `createRespawnFn`
 * populates it. The spawn state is allocated by `createRespawnFn` (one per
 * call) and threaded in — this is the bridge that gives `onExit` access to
 * the adapter without losing per-spawn identity.
 */
export type RespawnDeps = {
  db: Database.Database;
  eventsDir: string;
  buildCallbacks: (agentId: string, spawnState: SpawnState) => AdapterCallbacks;
  /**
   * Source-of-truth Map of "user input that hasn't been turn-complete'd yet
   * for an agent" (token-recovery v0.1.17). The orchestrator sets the entry
   * right before calling `adapter.sendInput`, and clears it on `turn-complete`.
   * After a respawn — auto-recovery (auth error) or user-reconnect — we re-emit
   * the captured turn so the user gets a response. If no entry exists, the
   * respawn proceeds silently (e.g. a clean restart of an idle agent).
   *
   * v0.1.18: value upgraded from raw `string` to `{ content, messageId }` so
   * the respawn re-emit path can route back through the orchestrator's
   * `writeStdin`, which loads message attachments by `messageId` (Task 11).
   */
  pendingTurnByAgent: Map<string, PendingTurn>;
  /**
   * The orchestrator's canonical "write user input to the live adapter" entry
   * point. Re-used here so the respawn re-emit path goes through the same code
   * that loads attachments + builds content blocks (Task 11), instead of
   * calling `adapter.sendInput(text)` directly and bypassing that pipeline.
   */
  writeStdin: (agentId: string, content: string, messageId: string | null) => void;
};

/**
 * Re-spawns the adapter for `agentId`. Returns the spawned adapter so callers
 * can eagerly capture `thisSpawn` (mirrors the original `.then(a => thisSpawn = a)`
 * semantics — required so a stale onExit firing before any event still
 * compares the live registry against the ORIGINAL adapter, not a successor).
 * Returns `null` when the agent row is gone (no-op).
 */
export type RespawnFn = (agentId: string) => Promise<AgentAdapter | null>;

/**
 * Builds the SpawnContext the same way `orchestrator-handlers.ts` did inline
 * (M11 memory block, M12 instruction bundle, M13 TELOS, project-context digest,
 * credentials from token storage), then calls `ensureAdapter`. Pure refactor of
 * the existing inline block — no behavior change. The recovery module (added
 * in later tasks of the token-recovery v0.1.17 hotfix) calls this to re-spawn
 * an agent after a fresh OAuth token is on disk.
 */
export const createRespawnFn = (deps: RespawnDeps): RespawnFn => {
  return async (agentId: string): Promise<AgentAdapter | null> => {
    const agents = createAgentsRepository(deps.db);
    let agent = agents.getById(agentId);
    if (agent === null) return null;

    // v0.1.38 orphaned-session guard: a stored claudeSessionId from the old
    // sandbox layout (agent-sandbox/<id>) has no transcript under the new
    // sbx/<slug> config dir, so `claude --resume <id>` exits 1 ("No conversation
    // found"), the message this spawn was meant to handle is delivered to the
    // dying process and lost, and the agent is stranded in `error`. Drop the
    // stale session so it starts fresh instead — the intended v0.1.38 behaviour,
    // minus the error + lost message.
    if (
      agent.claudeSessionId !== null &&
      !sessionTranscriptExists(
        getAgentConfigDir(app.getPath("userData"), agent.id),
        agent.claudeSessionId,
      )
    ) {
      agents.clearSessionId(agent.id);
      agent = { ...agent, claudeSessionId: null };
    }

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

    // Memória de Contexto de Projeto: inject the digest map for the agent's
    // compaction target. Single-project agents get that project's digest (verified
    // against the live repo). The CEO / multi-project agents (allowedProjects=[]
    // or several) get their AGENT-scoped digest — so the CEO both compacts AND
    // gets its durable digest re-injected, instead of never seeing one.
    let projectContextBlock: string | undefined;
    const ctxTarget = compactionTarget(agent);
    if (ctxTarget.kind === "project") {
      const proj = createProjectsRepository(deps.db).getById(ctxTarget.projectId);
      if (proj !== null) {
        projectContextBlock = buildProjectContextBlock({
          userDataDir: app.getPath("userData"),
          companyId: agent.companyId,
          projectId: proj.id,
          projectPath: proj.path,
        });
      }
    } else {
      projectContextBlock = buildAgentContextBlock({
        userDataDir: app.getPath("userData"),
        companyId: agent.companyId,
        agentId: ctxTarget.agentId,
      });
    }

    // Audit 2026-06-03 Facet 3 C1: build the CEO capability boundary from the
    // company's REAL connected channels (host-side; build-args has no DB), so
    // the CEO only proposes what the system can actually deliver — instead of a
    // hardcoded ["x"]. Consumed only for the CEO; harmless to compute always.
    const capabilityBoundary = buildCapabilityBoundary(
      listConnectedChannels(deps.db, agent.companyId),
    );

    // Onda A #2 (token): once the company has an approved business plan, the CEO
    // is past genesis — build-args drops the ~4.5 KB genesis playbook from its
    // prompt. Computed here (build-args has no DB); harmless to compute for
    // non-CEO agents (build-args only consults it on the CEO branch).
    const companyHasApprovedBusiness =
      createBusinessPlansRepository(deps.db).getLatestApprovedForCompany(agent.companyId) !== null;

    // Audit 2026-06-03 Inteligência & Contexto I2: respawn is the sole
    // SpawnContext constructor; it must resolve narrated-active host-side (the
    // adapter comment says the host owns this) or buildNarratedBlock() is dead
    // code. The block only applies to a CEO mid-narrated-loop, so only set it
    // when the goals repo reports an active narrated execution for THIS agent.
    // Safe: only ever set to true; absence leaves the slot off (atomic default).
    const narratedActive =
      createGoalsRepository(deps.db).findActiveNarratedByCeo(agent.id) !== null;

    const opts: EnsureAdapterOptions = {
      agent,
      ...(oauthToken !== undefined ? { oauthToken } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
      userDataDir: app.getPath("userData"),
      dbPath: databasePath(),
      permissionsDir: getPermissionsDir(app.getPath("userData")),
      eventsDir: deps.eventsDir,
      ...(narratedActive ? { narratedActive: true } : {}),
      ...(memoryBlock !== undefined ? { memoryBlock } : {}),
      ...(telosBlock !== undefined ? { telosBlock } : {}),
      ...(projectContextBlock !== undefined ? { projectContextBlock } : {}),
      instructionsBlock,
      capabilityBoundary,
      companyHasApprovedBusiness,
    };

    // Allocate a fresh per-spawn cell BEFORE buildCallbacks so the callback
    // closures embed THIS cell. After ensureAdapter resolves, populate it —
    // this happens before any callback fires (the OS can only deliver events
    // once the spawn is observably alive, and we await ensureAdapter here).
    const spawnState: SpawnState = { adapter: null };
    const callbacks = deps.buildCallbacks(agentId, spawnState);
    const adapter = await ensureAdapter(opts, callbacks);
    spawnState.adapter = adapter;

    // Re-emit pending turn if any (token-recovery v0.1.17). Applies to BOTH
    // auto-recovery (auth error mid-turn) and user-reconnect: in both cases a
    // user message is still awaiting a response. If no pending turn exists
    // (e.g. clean restart of an idle agent on model change), nothing to do.
    const pending = deps.pendingTurnByAgent.get(agentId);
    if (pending !== undefined) {
      deps.writeStdin(agentId, pending.content, pending.messageId);
    }

    return adapter;
  };
};
