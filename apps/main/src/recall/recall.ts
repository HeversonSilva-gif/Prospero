// Active recall (v0.1.35): on issue assignment, surface relevant skills +
// memories for the issue as a one-time context block injected into the agent's
// next turn. Zero LLM calls — pure local FTS / keyword scoring.

import type Database from "better-sqlite3";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createSkillsRepository } from "../memory/skills-repository.js";

// ---------------------------------------------------------------------------
// Tokenise
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "was",
  "with",
  "that",
  "this",
  "from",
  "have",
  "had",
  "has",
  "not",
  "but",
  "they",
  "you",
  "all",
  "can",
  "will",
  "one",
  "its",
  "been",
  "our",
  "por",
  "que",
  "para",
  "com",
  "uma",
  "dos",
  "das",
  "ser",
  "seu",
  "ela",
  "ele",
  "seu",
  "uma",
  "isso",
  "mais",
]);

/** Tokenise text into lowercase keywords (≥3 chars, no stopwords). */
export const tokenise = (text: string): string[] => {
  const raw = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(raw)]; // deduplicate
};

// ---------------------------------------------------------------------------
// FTS safe-quoting (OR-join for recall, mirrors toFtsMatchExpr from
// learning-handlers but joins with OR instead of implicit AND)
// ---------------------------------------------------------------------------

const toFtsOrExpr = (keywords: string[]): string =>
  keywords.map((w) => `"${w.replace(/"/g, '""')}"`).join(" OR ");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecallInput = {
  companyId: string;
  agentId: string;
  issueText: string;
  limit?: number;
};

export type RecallHits = {
  skills: Array<{ name: string; description: string }>;
  memories: Array<{ body: string }>;
};

// ---------------------------------------------------------------------------
// recallForIssue
// ---------------------------------------------------------------------------

export const recallForIssue = (db: Database.Database, input: RecallInput): RecallHits => {
  const limit = input.limit ?? 3;
  const keywords = tokenise(input.issueText);

  // --- Memories (FTS) -------------------------------------------------------
  let memories: Array<{ body: string }> = [];
  if (keywords.length > 0) {
    try {
      const ftsExpr = toFtsOrExpr(keywords);
      const memRepo = createMemoriesRepository(db);
      const rows = memRepo.search(ftsExpr, {
        companyId: input.companyId,
        limit,
      });
      memories = rows.map((m) => ({ body: m.body }));
    } catch {
      // FTS errors (e.g. invalid query on edge-case input) must never crash the observer.
      memories = [];
    }
  }

  // --- Skills (keyword scoring) ---------------------------------------------
  const skillRepo = createSkillsRepository(db);
  const pool = [
    ...skillRepo.listByAgent(input.agentId),
    ...skillRepo.listCompanyShared(input.companyId),
  ];

  // Deduplicate by id (a shared skill can appear in both lists)
  const seen = new Set<string>();
  const unique = pool.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  // Score by keyword hits in name+description
  const scored = unique
    .map((s) => {
      const haystack = (s.name + " " + s.description).toLowerCase();
      const score = keywords.filter((kw) => haystack.includes(kw)).length;
      return { skill: s, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.skill.useCount - a.skill.useCount;
    })
    .slice(0, limit)
    .map(({ skill }) => ({ name: skill.name, description: skill.description }));

  return { skills: scored, memories };
};

// ---------------------------------------------------------------------------
// formatRecallSeed
// ---------------------------------------------------------------------------

const CAP = 200;
const capLine = (s: string): string => (s.length > CAP ? s.slice(0, CAP) + "…" : s);

export const formatRecallSeed = (hits: RecallHits): string | null => {
  if (hits.skills.length === 0 && hits.memories.length === 0) return null;

  const lines: string[] = ["[CONHECIMENTO RELEVANTE PARA ESTA TAREFA]"];

  if (hits.skills.length > 0) {
    lines.push("Skills que podem ajudar (use skill_read para abrir):");
    for (const s of hits.skills) {
      lines.push(`- ${capLine(s.name)}: ${capLine(s.description)}`);
    }
  }

  if (hits.memories.length > 0) {
    lines.push("Memórias relevantes:");
    for (const m of hits.memories) {
      lines.push(`- ${capLine(m.body.trim())}`);
    }
  }

  return lines.join("\n");
};
