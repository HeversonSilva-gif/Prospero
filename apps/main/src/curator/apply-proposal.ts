import type Database from "better-sqlite3";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Skill } from "@prospero/shared";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createProposalsRepository } from "./proposals-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { getAgentMemoryDir, getCompanyMemoryDir, skillBodyPath } from "../memory/memory-dir.js";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
import { assertValidSkillName } from "../memory/skill-name.js";

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

// Backs up the current file content to a .bak sibling before overwriting.
// The backup is best-effort: if the file does not exist yet, skip. Keeps the
// previous body recoverable if a bad patch is accepted by mistake.
const backupSkillFile = (bodyPath: string): void => {
  try {
    if (existsSync(bodyPath)) {
      const prior = readFileSync(bodyPath, "utf8");
      writeFileSync(`${bodyPath}.bak`, prior, "utf8");
    }
  } catch {
    // Best-effort: do not block apply on a backup failure.
  }
};

// Applies an accepted proposal. merge: write the combined SKILL.md (company
// scope if the sources span >1 agent, else that agent's scope), create a
// `curated_merge` skill, soft-delete the sources. patch: rewrite the target
// body, bump version + patch_count. archive: set the target archived.
//
// All file + DB mutations for a single proposal are wrapped in a SQLite
// transaction so a mid-apply crash cannot leave partial state. Validation
// (sanitize + name) fires BEFORE the transaction so rejected bodies throw
// without opening a tx.
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

  // ── Validation BEFORE transaction ────────────────────────────────────────
  // All guards throw here so no transaction is opened on a bad proposal.

  if (proposal.kind === "merge") {
    const name = (input.name ?? proposal.proposedName ?? "").trim();
    const description = (input.description ?? proposal.proposedDescription ?? "").trim();
    const body = input.body ?? proposal.proposedBody ?? "";
    if (name === "" || description === "" || body.trim() === "") {
      throw new Error("merge requires name, description, and body");
    }
    assertValidSkillName(name);
    const descSanitize = sanitizeMemoryBody(description);
    if (!descSanitize.ok) throw new Error(`skill description rejected: ${descSanitize.reason}`);
    const bodySanitize = sanitizeMemoryBody(body);
    if (!bodySanitize.ok) throw new Error(`skill body rejected: ${bodySanitize.reason}`);
  } else if (proposal.kind === "patch") {
    const target = sources[0]!;
    const description = (
      input.description ??
      proposal.proposedDescription ??
      target.description
    ).trim();
    const body = input.body ?? proposal.proposedBody ?? "";
    if (body.trim() === "") throw new Error("patch requires a body");
    const patchDescSanitize = sanitizeMemoryBody(description);
    if (!patchDescSanitize.ok)
      throw new Error(`skill description rejected: ${patchDescSanitize.reason}`);
    const patchBodySanitize = sanitizeMemoryBody(body);
    if (!patchBodySanitize.ok) throw new Error(`skill body rejected: ${patchBodySanitize.reason}`);

    // Staleness check: if the proposal carried a source version snapshot and
    // the source skill has been edited since the snapshot was taken, refuse
    // rather than clobber the newer edits.
    if (proposal.sourceVersions !== null) {
      const snapshotVersion = proposal.sourceVersions[target.id];
      if (snapshotVersion !== undefined && target.version !== snapshotVersion) {
        throw new Error(
          `patch proposal is stale: source skill "${target.name}" was at version ${snapshotVersion} when the proposal was created but is now at version ${target.version}. Reject this proposal and let the curator re-evaluate.`,
        );
      }
    }
  }

  // ── Atomic apply (file write + all DB mutations in one transaction) ───────
  // Mirrors the pattern in curator/lifecycle.ts where state + inbox are written
  // together so a crash cannot leave a skill transitioned but the notice lost.

  let result!: Skill;

  const applyTx = db.transaction(() => {
    if (proposal.kind === "merge") {
      const name = (input.name ?? proposal.proposedName ?? "").trim();
      const description = (input.description ?? proposal.proposedDescription ?? "").trim();
      const body = input.body ?? proposal.proposedBody ?? "";
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
      // Backup the current body before overwriting (best-effort, inside tx so
      // the backup write happens atomically with the DB update).
      backupSkillFile(target.bodyPath);
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
  });

  applyTx();
  return result;
};

export type RejectProposalInput = { proposalId: string; reviewedBy: string; reason?: string };

export const rejectProposal = (db: Database.Database, input: RejectProposalInput): void => {
  const proposalsRepo = createProposalsRepository(db);
  const proposal = proposalsRepo.getById(input.proposalId);
  if (proposal === null) throw new Error(`skill proposal not found: ${input.proposalId}`);
  if (proposal.status !== "pending") throw new Error(`skill proposal already ${proposal.status}`);
  proposalsRepo.updateStatus(input.proposalId, "rejected", input.reviewedBy, input.reason);
  resolveInbox(db, input.proposalId);
};
