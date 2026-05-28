import type Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Skill } from "@prospero/shared";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createProposalsRepository } from "./proposals-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { getAgentMemoryDir, getCompanyMemoryDir, skillBodyPath } from "../memory/memory-dir.js";

export type AcceptProposalInput = {
  proposalId: string;
  reviewedBy: string;
  // Edit-flow overrides for merge/patch (omitted = use the proposed values).
  name?: string;
  description?: string;
  body?: string;
};

const resolveInbox = (db: Database.Database, proposalId: string): void => {
  const row = db
    .prepare(
      "SELECT id FROM inbox_items WHERE kind='skill_consolidation_proposed' AND read_at IS NULL AND payload_json LIKE ? LIMIT 1",
    )
    .get(`%${proposalId}%`) as { id: string } | undefined;
  if (row !== undefined) createInboxRepository(db).markRead(row.id);
};

// Applies an accepted proposal. merge: write the combined SKILL.md (company
// scope if the sources span >1 agent, else that agent's scope), create a
// `curated_merge` skill, soft-delete the sources. patch: rewrite the target
// body, bump version + patch_count. archive: set the target archived.
export const acceptProposal = (
  db: Database.Database,
  userDataDir: string,
  input: AcceptProposalInput,
): Skill => {
  const proposalsRepo = createProposalsRepository(db);
  const skillsRepo = createSkillsRepository(db);
  const proposal = proposalsRepo.getById(input.proposalId);
  if (proposal === null) throw new Error(`skill proposal not found: ${input.proposalId}`);
  if (proposal.status !== "pending") throw new Error(`skill proposal already ${proposal.status}`);

  const sources = proposal.sourceSkillIds
    .map((id) => skillsRepo.getById(id))
    .filter((s): s is Skill => s !== null);
  if (sources.length === 0) throw new Error("skill proposal references no live skills");

  let result: Skill;

  if (proposal.kind === "merge") {
    const name = (input.name ?? proposal.proposedName ?? "").trim();
    const description = (input.description ?? proposal.proposedDescription ?? "").trim();
    const body = input.body ?? proposal.proposedBody ?? "";
    if (name === "" || description === "" || body.trim() === "") {
      throw new Error("merge requires name, description, and body");
    }
    const agentIds = new Set(sources.map((s) => s.agentId));
    const singleAgent = agentIds.size === 1 ? [...agentIds][0]! : null;
    const scopeDir =
      singleAgent !== null
        ? getAgentMemoryDir(userDataDir, proposal.companyId, singleAgent)
        : getCompanyMemoryDir(userDataDir, proposal.companyId);
    const bodyPath = skillBodyPath(scopeDir, name);
    mkdirSync(dirname(bodyPath), { recursive: true });
    writeFileSync(bodyPath, body, "utf8");
    result = skillsRepo.create({
      companyId: proposal.companyId,
      agentId: singleAgent,
      name,
      bodyPath,
      description,
      source: "curated_merge",
    });
    for (const s of sources) skillsRepo.softDelete(s.id);
  } else if (proposal.kind === "patch") {
    const target = sources[0]!;
    const description = (
      input.description ??
      proposal.proposedDescription ??
      target.description
    ).trim();
    const body = input.body ?? proposal.proposedBody ?? "";
    if (body.trim() === "") throw new Error("patch requires a body");
    writeFileSync(target.bodyPath, body, "utf8");
    skillsRepo.update(target.id, { description });
    skillsRepo.recordPatch(target.id);
    result = skillsRepo.getById(target.id)!;
  } else {
    // archive
    const target = sources[0]!;
    skillsRepo.setLifecycleState(target.id, "archived", Date.now());
    result = skillsRepo.getById(target.id)!;
  }

  proposalsRepo.updateStatus(input.proposalId, "accepted", input.reviewedBy);
  resolveInbox(db, input.proposalId);
  return result;
};

export type RejectProposalInput = { proposalId: string; reviewedBy: string; reason?: string };

export const rejectProposal = (db: Database.Database, input: RejectProposalInput): void => {
  const proposalsRepo = createProposalsRepository(db);
  const proposal = proposalsRepo.getById(input.proposalId);
  if (proposal === null) throw new Error(`skill proposal not found: ${input.proposalId}`);
  if (proposal.status !== "pending") throw new Error(`skill proposal already ${input.proposalId}`);
  proposalsRepo.updateStatus(input.proposalId, "rejected", input.reviewedBy, input.reason);
  resolveInbox(db, input.proposalId);
};
