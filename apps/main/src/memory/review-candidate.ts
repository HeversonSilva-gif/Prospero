import type Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Skill, SkillSource, SkillCandidateTrigger } from "@prospero/shared";
import { createSkillCandidatesRepository } from "./skill-candidates-repository.js";
import { createSkillsRepository } from "./skills-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { getAgentMemoryDir, skillBodyPath } from "./memory-dir.js";
import { sanitizeMemoryBody } from "./sanitizer.js";
import { assertValidSkillName } from "./skill-name.js";

// Maps the candidate's derivation trigger to the resulting skill's source.
const SOURCE_BY_TRIGGER: Record<SkillCandidateTrigger, SkillSource> = {
  issue_done: "derived_from_issue",
  recovery: "derived_from_recovery",
  verification_failed: "derived_from_verification",
};

export type AcceptCandidateInput = {
  candidateId: string;
  reviewedBy: string;
  // Optional overrides — the "Edit" flow. Omitted fields fall back to the
  // candidate's proposed values.
  name?: string;
  description?: string;
  body?: string;
};

// Accepts a pending skill candidate: writes its SKILL.md, creates the skills
// row, marks the candidate accepted, and resolves its inbox item. Throws if
// the candidate is missing or already reviewed, or (via the skills unique
// index) if a skill with that name already exists for the agent.
export const acceptSkillCandidate = (
  db: Database.Database,
  userDataDir: string,
  input: AcceptCandidateInput,
): Skill => {
  const candidatesRepo = createSkillCandidatesRepository(db);
  const candidate = candidatesRepo.getById(input.candidateId);
  if (candidate === null) throw new Error(`skill candidate not found: ${input.candidateId}`);
  if (candidate.status !== "pending") {
    throw new Error(`skill candidate already ${candidate.status}`);
  }
  const name = (input.name ?? candidate.proposedName).trim();
  const description = (input.description ?? candidate.proposedDescription).trim();
  const body = input.body ?? candidate.proposedBody;
  if (name === "" || description === "" || body.trim() === "") {
    throw new Error("skill name, description, and body are all required");
  }
  assertValidSkillName(name);
  const descSanitize = sanitizeMemoryBody(description);
  if (!descSanitize.ok) throw new Error(`skill description rejected: ${descSanitize.reason}`);
  const bodySanitize = sanitizeMemoryBody(body);
  if (!bodySanitize.ok) throw new Error(`skill body rejected: ${bodySanitize.reason}`);
  const scopeDir = getAgentMemoryDir(userDataDir, candidate.companyId, candidate.agentId);
  const bodyPath = skillBodyPath(scopeDir, name);
  mkdirSync(dirname(bodyPath), { recursive: true });
  writeFileSync(bodyPath, body, "utf8");
  const skill = createSkillsRepository(db).create({
    companyId: candidate.companyId,
    agentId: candidate.agentId,
    name,
    bodyPath,
    description,
    source: SOURCE_BY_TRIGGER[candidate.trigger],
  });
  candidatesRepo.updateStatus(input.candidateId, "accepted", input.reviewedBy);
  createInboxRepository(db).markReadByCandidateId(input.candidateId);
  return skill;
};

export type RejectCandidateInput = {
  candidateId: string;
  reviewedBy: string;
  reason?: string;
};

// Rejects a pending skill candidate and resolves its inbox item. Throws if the
// candidate is missing or already reviewed.
export const rejectSkillCandidate = (db: Database.Database, input: RejectCandidateInput): void => {
  const candidatesRepo = createSkillCandidatesRepository(db);
  const candidate = candidatesRepo.getById(input.candidateId);
  if (candidate === null) throw new Error(`skill candidate not found: ${input.candidateId}`);
  if (candidate.status !== "pending") {
    throw new Error(`skill candidate already ${candidate.status}`);
  }
  candidatesRepo.updateStatus(input.candidateId, "rejected", input.reviewedBy, input.reason);
  createInboxRepository(db).markReadByCandidateId(input.candidateId);
};
