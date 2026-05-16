import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { IPC } from "@prospero/shared";
import type { Skill, Memory, SessionSearchHit, SenderKind } from "@prospero/shared";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";

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
};

type SessionRow = {
  message_id: string;
  content: string;
  created_at: number;
  sender_kind: SenderKind;
  sender_id: string | null;
};

export const learningHandlers = (db: Database.Database): LearningHandlers => {
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
  };
};

export const registerLearningHandlers = (db: Database.Database): void => {
  const h = learningHandlers(db);
  ipcMain.handle(IPC.SKILLS_LIST_FOR_AGENT, (_e, args: { agentId: string }) => h.listSkills(args));
  ipcMain.handle(IPC.SKILLS_READ_BODY, (_e, args: { skillId: string }) => h.readSkillBody(args));
  ipcMain.handle(IPC.MEMORIES_LIST_FOR_AGENT, (_e, args: { agentId: string }) =>
    h.listMemories(args),
  );
  ipcMain.handle(
    IPC.SESSION_SEARCH,
    (_e, args: { agentId: string; query: string; limit?: number }) => h.searchSessions(args),
  );
};
