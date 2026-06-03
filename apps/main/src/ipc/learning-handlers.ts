import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IPC } from "@prospero/shared";
import { getUserMemoryPath } from "../memory/memory-dir.js";
import type {
  Skill,
  Memory,
  SessionSearchHit,
  SenderKind,
  SkillCandidate,
  SkillProposal,
} from "@prospero/shared";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createSkillCandidatesRepository } from "../memory/skill-candidates-repository.js";
import { acceptSkillCandidate, rejectSkillCandidate } from "../memory/review-candidate.js";
import { createInboxRepository } from "../inbox/repository.js";
import {
  acceptProposal as applyAcceptProposal,
  rejectProposal as applyRejectProposal,
} from "../curator/apply-proposal.js";
import { createProposalsRepository } from "../curator/proposals-repository.js";
import { toFtsMatchExpr } from "../memory/fts-query.js";

// M11 PR-F1: a thumb up/down on a skill or memory.
type RateDirection = "up" | "down";
// Asymmetric, per spec §8: distrust accrues faster than trust.
const TRUST_DELTA: Record<RateDirection, number> = { up: 0.05, down: -0.1 };

// Re-export so existing callers of this module continue to work.
export { toFtsMatchExpr };

export type LearningHandlers = {
  // Private skills of the agent + the company-shared skills it inherits.
  listSkills(args: { agentId: string }): Skill[];
  // Full SKILL.md body of one skill. Throws if the skill or file is missing.
  readSkillBody(args: { skillId: string }): { body: string };
  // The agent's declarative memory rows.
  listMemories(args: { agentId: string }): Memory[];
  // FTS5 search over the agent's past messages.
  searchSessions(args: { agentId: string; query: string; limit?: number }): SessionSearchHit[];
  // Pending skill candidates derived for the agent (PR-D auto-derivation).
  listCandidates(args: { agentId: string }): SkillCandidate[];
  // Accept a candidate -> creates a real skill. Optional overrides = the Edit flow.
  acceptCandidate(args: {
    candidateId: string;
    name?: string;
    description?: string;
    body?: string;
  }): Skill;
  // Reject a candidate; optional reason is persisted.
  rejectCandidate(args: { candidateId: string; reason?: string }): { ok: true };
  // Approve a pending skill-promotion request: promotes the skill to
  // company-shared (optionally role-scoped) and resolves its inbox item.
  approveSkillPromotion(args: { skillId: string; appliesToRole: string | null }): Skill;
  // Dashboard "Org Learnings" data: top company-shared skills + recent
  // retrospective memories.
  orgLearnings(args: { companyId: string }): {
    topSkills: Skill[];
    recentRetrospectives: Memory[];
  };
  // M11 PR-F1: user thumb up/down on a skill / memory — steers L0 trust.
  rateSkill(args: { skillId: string; direction: RateDirection }): Skill;
  rateMemory(args: { memoryId: string; direction: RateDirection }): Memory;
  // M11 PR-F2: the global user.md memory file ("About the user" prompt slot).
  getUserMemory(): { content: string };
  setUserMemory(args: { content: string }): { ok: true };
  // Loads the user's Claude Code memory (~/.claude/CLAUDE.md) so it can be
  // reviewed and saved into user.md. Returns "" when there is no such file.
  importClaudeCodeMemory(): { content: string };
  // M11 PR-F2: on agent termination, promote the chosen private skills to the
  // agent's role (so future hires for that role inherit them) and soft-delete
  // the agent's remaining private skills.
  promoteSkillsOnTerminate(args: { agentId: string; promoteSkillIds: string[] }): {
    promoted: number;
    softDeleted: number;
  };
  // Curator: list pending skill-consolidation proposals for a company.
  listProposals(args: { companyId: string }): SkillProposal[];
  // Curator: accept a proposal (merge/patch/archive), optionally with edit-flow overrides.
  acceptProposal(args: {
    proposalId: string;
    name?: string;
    description?: string;
    body?: string;
  }): Skill;
  // Curator: reject a proposal with an optional reason.
  rejectProposal(args: { proposalId: string; reason?: string }): { ok: true };
};

type SessionRow = {
  message_id: string;
  content: string;
  created_at: number;
  sender_kind: SenderKind;
  sender_id: string | null;
};

export const learningHandlers = (db: Database.Database, userDataDir: string): LearningHandlers => {
  const skillsRepo = createSkillsRepository(db);
  const memoriesRepo = createMemoriesRepository(db);
  const companyOfAgent = db.prepare("SELECT company_id FROM agents WHERE id = ?");
  const agentRoleStmt = db.prepare("SELECT role FROM agents WHERE id = ?");
  const searchStmt = db.prepare(
    `SELECT m.id AS message_id, m.content AS content, m.created_at AS created_at,
            m.sender_kind AS sender_kind, m.sender_id AS sender_id
       FROM messages_fts f
       JOIN messages m ON m.id = f.message_id
       JOIN threads t ON t.id = m.thread_id
      WHERE messages_fts MATCH ?
        AND t.participants_json LIKE '%' || ? || '%'
      ORDER BY rank
      LIMIT ?`,
  );

  return {
    listSkills({ agentId }) {
      const row = companyOfAgent.get(agentId) as { company_id: string } | undefined;
      if (row === undefined) return [];
      return [...skillsRepo.listByAgent(agentId), ...skillsRepo.listCompanyShared(row.company_id)];
    },

    readSkillBody({ skillId }) {
      const skill = skillsRepo.getById(skillId);
      if (skill === null) throw new Error(`skill not found: ${skillId}`);
      return { body: readFileSync(skill.bodyPath, "utf8") };
    },

    listMemories({ agentId }) {
      return memoriesRepo.listByAgent(agentId);
    },

    searchSessions({ agentId, query, limit }) {
      const expr = toFtsMatchExpr(query);
      if (expr === "") return [];
      const rows = searchStmt.all(expr, agentId, limit ?? 50) as SessionRow[];
      return rows.map((r) => ({
        messageId: r.message_id,
        content: r.content,
        createdAt: r.created_at,
        senderKind: r.sender_kind,
        senderId: r.sender_id,
      }));
    },

    listCandidates({ agentId }) {
      return createSkillCandidatesRepository(db).listPendingByAgent(agentId);
    },

    acceptCandidate({ candidateId, name, description, body }) {
      return acceptSkillCandidate(db, userDataDir, {
        candidateId,
        reviewedBy: "user",
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(body !== undefined ? { body } : {}),
      });
    },

    rejectCandidate({ candidateId, reason }) {
      rejectSkillCandidate(db, {
        candidateId,
        reviewedBy: "user",
        ...(reason !== undefined ? { reason } : {}),
      });
      return { ok: true };
    },

    approveSkillPromotion({ skillId, appliesToRole }) {
      const skill = createSkillsRepository(db).promote(skillId, appliesToRole);
      const inboxRow = db
        .prepare(
          `SELECT id FROM inbox_items
            WHERE kind = 'skill_promotion_requested' AND read_at IS NULL AND payload_json LIKE ?
            LIMIT 1`,
        )
        .get(`%${skillId}%`) as { id: string } | undefined;
      if (inboxRow !== undefined) createInboxRepository(db).markRead(inboxRow.id);
      return skill;
    },

    orgLearnings({ companyId }) {
      const topSkills = createSkillsRepository(db).listCompanyShared(companyId).slice(0, 10);
      const recentRetrospectives = createMemoriesRepository(db)
        .listCompanyWide(companyId)
        .filter((m) => m.kind === "retrospective")
        .slice(0, 5);
      return { topSkills, recentRetrospectives };
    },

    rateSkill({ skillId, direction }) {
      return skillsRepo.bumpTrust(skillId, TRUST_DELTA[direction]);
    },
    rateMemory({ memoryId, direction }) {
      return memoriesRepo.bumpTrust(memoryId, TRUST_DELTA[direction]);
    },
    getUserMemory() {
      const path = getUserMemoryPath(userDataDir);
      return { content: existsSync(path) ? readFileSync(path, "utf8") : "" };
    },
    setUserMemory({ content }) {
      try {
        writeFileSync(getUserMemoryPath(userDataDir), content, "utf8");
      } catch (err) {
        throw new Error(`Failed to save user memory: ${(err as NodeJS.ErrnoException).message}`);
      }
      return { ok: true as const };
    },
    importClaudeCodeMemory() {
      const path = join(homedir(), ".claude", "CLAUDE.md");
      return { content: existsSync(path) ? readFileSync(path, "utf8") : "" };
    },
    promoteSkillsOnTerminate({ agentId, promoteSkillIds }) {
      const agentRow = agentRoleStmt.get(agentId) as { role: string } | undefined;
      if (agentRow === undefined) throw new Error(`agent ${agentId} not found`);
      const promoteSet = new Set(promoteSkillIds);
      let promoted = 0;
      let softDeleted = 0;
      db.transaction(() => {
        for (const skill of skillsRepo.listByAgent(agentId)) {
          if (promoteSet.has(skill.id)) {
            skillsRepo.promote(skill.id, agentRow.role);
            promoted += 1;
          } else {
            // promoteSkillIds that don't match a private skill are silently ignored —
            // stale IDs from the UI are harmless; the loop only touches listByAgent rows.
            skillsRepo.softDelete(skill.id);
            softDeleted += 1;
          }
        }
      })();
      return { promoted, softDeleted };
    },

    listProposals({ companyId }) {
      return createProposalsRepository(db).listPending(companyId);
    },

    acceptProposal({ proposalId, name, description, body }) {
      return applyAcceptProposal(db, userDataDir, {
        proposalId,
        reviewedBy: "user",
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(body !== undefined ? { body } : {}),
      });
    },

    rejectProposal({ proposalId, reason }) {
      applyRejectProposal(db, {
        proposalId,
        reviewedBy: "user",
        ...(reason !== undefined ? { reason } : {}),
      });
      return { ok: true as const };
    },
  };
};

export const registerLearningHandlers = (db: Database.Database): void => {
  const h = learningHandlers(db, app.getPath("userData"));
  ipcMain.handle(IPC.SKILLS_LIST_FOR_AGENT, (_e, args: { agentId: string }) => h.listSkills(args));
  ipcMain.handle(IPC.SKILLS_READ_BODY, (_e, args: { skillId: string }) => h.readSkillBody(args));
  ipcMain.handle(IPC.MEMORIES_LIST_FOR_AGENT, (_e, args: { agentId: string }) =>
    h.listMemories(args),
  );
  ipcMain.handle(
    IPC.SESSION_SEARCH,
    (_e, args: { agentId: string; query: string; limit?: number }) => h.searchSessions(args),
  );
  ipcMain.handle(IPC.SKILL_CANDIDATES_LIST_FOR_AGENT, (_e, args: { agentId: string }) =>
    h.listCandidates(args),
  );
  ipcMain.handle(
    IPC.SKILL_CANDIDATE_ACCEPT,
    (_e, args: { candidateId: string; name?: string; description?: string; body?: string }) =>
      h.acceptCandidate(args),
  );
  ipcMain.handle(IPC.SKILL_CANDIDATE_REJECT, (_e, args: { candidateId: string; reason?: string }) =>
    h.rejectCandidate(args),
  );
  ipcMain.handle(
    IPC.SKILL_PROMOTE_APPROVE,
    (_e, args: { skillId: string; appliesToRole: string | null }) => h.approveSkillPromotion(args),
  );
  ipcMain.handle(IPC.LEARNING_ORG, (_e, args: { companyId: string }) => h.orgLearnings(args));
  ipcMain.handle(
    IPC.LEARNING_RATE_SKILL,
    (_e, args: { skillId: string; direction: RateDirection }) => h.rateSkill(args),
  );
  ipcMain.handle(
    IPC.LEARNING_RATE_MEMORY,
    (_e, args: { memoryId: string; direction: RateDirection }) => h.rateMemory(args),
  );
  ipcMain.handle(IPC.MEMORY_USER_GET, () => h.getUserMemory());
  ipcMain.handle(IPC.MEMORY_USER_SET, (_e, args: { content: string }) => h.setUserMemory(args));
  ipcMain.handle(IPC.MEMORY_USER_IMPORT_CC, () => h.importClaudeCodeMemory());
  ipcMain.handle(
    IPC.SKILLS_PROMOTE_ON_TERMINATE,
    (_e, args: { agentId: string; promoteSkillIds: string[] }) => h.promoteSkillsOnTerminate(args),
  );
  ipcMain.handle(IPC.SKILL_PROPOSALS_LIST, (_e, args: { companyId: string }) =>
    h.listProposals(args),
  );
  ipcMain.handle(
    IPC.SKILL_PROPOSAL_ACCEPT,
    (_e, args: { proposalId: string; name?: string; description?: string; body?: string }) =>
      h.acceptProposal(args),
  );
  ipcMain.handle(IPC.SKILL_PROPOSAL_REJECT, (_e, args: { proposalId: string; reason?: string }) =>
    h.rejectProposal(args),
  );
};
