import { app, ipcMain } from "electron";
import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { IPC } from "@prospero/shared";
import type { Skill, Memory, SessionSearchHit, SenderKind, SkillCandidate } from "@prospero/shared";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createSkillCandidatesRepository } from "../memory/skill-candidates-repository.js";
import { acceptSkillCandidate, rejectSkillCandidate } from "../memory/review-candidate.js";
import { createInboxRepository } from "../inbox/repository.js";

// Turns raw search-box input into a safe FTS5 MATCH expression: each
// whitespace-separated term is wrapped in double quotes (so special characters
// can never break the query), and the quoted terms are joined by spaces, which
// FTS5 reads as an implicit AND. Returns "" for blank input.
export const toFtsMatchExpr = (query: string): string => {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" ");
};

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
};
