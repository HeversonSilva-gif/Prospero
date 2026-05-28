import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import type { RunDerivationResult } from "../derivation/runner.js";
import { createProposalsRepository } from "./proposals-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createCostsRepository } from "../costs/repository.js";
import { estimateCostCents } from "../costs/pricing.js";
import { buildLibrarianPrompt, type LibrarianSkill } from "./prompts.js";
import { parseProposals } from "./parse-proposals.js";

const DERIVATION_MODEL = "claude-sonnet-4-6";
const MIN_LIBRARY_SIZE = 3;

export type RunLibrarianDeps = {
  db: Database.Database;
  companyId: string;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
  authEnv: () => Record<string, string>;
  now: () => number;
};

export type LibrarianResult = { ran: boolean; proposalsCreated: number; tokens: number };

const log = (msg: string): void => {
  console.warn(`[curator] ${msg}`);
};

// One company's weekly library review. Snapshots active/stale skills, runs the
// Sonnet fork, persists valid proposals + inbox cards. Body read failures fall
// back to an empty body (the fork still sees name/description/counts).
export const runLibrarianFork = async (deps: RunLibrarianDeps): Promise<LibrarianResult> => {
  const rows = deps.db
    .prepare(
      "SELECT id, name, description, use_count, view_count, patch_count, trust, lifecycle_state, body_path " +
        "FROM skills WHERE company_id = ? AND soft_deleted = 0 AND lifecycle_state != 'archived'",
    )
    .all(deps.companyId) as {
    id: string;
    name: string;
    description: string;
    use_count: number;
    view_count: number;
    patch_count: number;
    trust: number;
    lifecycle_state: string;
    body_path: string;
  }[];

  if (rows.length < MIN_LIBRARY_SIZE) return { ran: false, proposalsCreated: 0, tokens: 0 };

  const skills: LibrarianSkill[] = rows.map((r) => {
    let body = "";
    try {
      body = readFileSync(r.body_path, "utf8");
    } catch {
      body = "";
    }
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      useCount: r.use_count,
      viewCount: r.view_count,
      patchCount: r.patch_count,
      trust: r.trust,
      lifecycleState: r.lifecycle_state as LibrarianSkill["lifecycleState"],
      body,
    };
  });

  let result: RunDerivationResult;
  try {
    result = await deps.runDerivation({
      prompt: buildLibrarianPrompt(skills),
      model: DERIVATION_MODEL,
      env: deps.authEnv(),
    });
  } catch (err) {
    log(`librarian fork failed for company ${deps.companyId}: ${String(err)}`);
    return { ran: true, proposalsCreated: 0, tokens: 0 };
  }

  createCostsRepository(deps.db).insert({
    companyId: deps.companyId,
    agentId: null,
    projectId: null,
    issueId: null,
    adapterName: "curator",
    model: DERIVATION_MODEL,
    sessionId: null,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    cacheCreationTokens: result.usage.cacheCreation,
    cacheReadTokens: result.usage.cacheRead,
    costCentsEstimate: estimateCostCents(DERIVATION_MODEL, {
      input: result.usage.input,
      output: result.usage.output,
      cache_creation: result.usage.cacheCreation,
      cache_read: result.usage.cacheRead,
    }),
    occurredAt: deps.now(),
  });

  const known = new Set(rows.map((r) => r.id));
  const proposals = parseProposals(result.text, known);
  const proposalsRepo = createProposalsRepository(deps.db);
  const inboxRepo = createInboxRepository(deps.db);
  let created = 0;
  for (const p of proposals) {
    const row = proposalsRepo.create({
      companyId: deps.companyId,
      kind: p.kind,
      sourceSkillIds: p.sourceSkillIds,
      proposedName: p.name,
      proposedDescription: p.description,
      proposedBody: p.body,
      rationale: p.rationale,
    });
    inboxRepo.create({
      companyId: deps.companyId,
      kind: "skill_consolidation_proposed",
      title: `Skill ${p.kind} proposed${p.name ? `: ${p.name}` : ""}`,
      preview: p.rationale.slice(0, 200),
      requiresAction: true,
      payloadJson: JSON.stringify({ proposalId: row.id }),
    });
    created += 1;
  }
  return { ran: true, proposalsCreated: created, tokens: result.usage.output };
};
