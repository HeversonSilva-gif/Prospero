import { existsSync, readFileSync } from "node:fs";
import type { MemoriesRepository } from "../memory/memories-repository.js";
import type { SkillsRepository } from "../memory/skills-repository.js";
import type { Memory, Skill } from "@prospero/shared";
import { getUserMemoryPath } from "../memory/memory-dir.js";
import { OPERATING_MANUAL_NAME, OPERATING_MANUAL_DESCRIPTION } from "./operating-manual.js";
import { ALGORITHM_NAME, ALGORITHM_DESCRIPTION } from "./algorithm.js";

// Per-section character caps (spec §6). Total ≈ 7.5 KB additional system prompt.
const USER_CAP = 1024;
const COMPANY_CAP = 1536;
const AGENT_CAP = 1024;
const SKILLS_CAP = 4096;

// M11 PR-F1: entries below this trust drop out of the L0 prompt budget.
// They remain reachable on-demand via skill_read / memory_search.
const MIN_L0_TRUST = 0.2;

export type BuildMemoryBlockDeps = {
  memoriesRepo: MemoriesRepository;
  skillsRepo: SkillsRepository;
  userDataDir: string;
  companyId: string;
  agentId: string;
  role: string;
};

// Joins entry bodies (already importance-sorted by the repo) until the cap.
// Returns the rendered text plus the ids actually written into the block, so
// the caller can record access (Audit 2026-06-03 Inteligência & Contexto I5).
const renderMemories = (rows: Memory[], cap: number): { text: string; renderedIds: string[] } => {
  let out = "";
  const renderedIds: string[] = [];
  for (const m of rows) {
    if (m.trust < MIN_L0_TRUST) continue;
    const line = `- ${m.body.trim()}\n`;
    if (out.length + line.length > cap) break;
    out += line;
    renderedIds.push(m.id);
  }
  return { text: out, renderedIds };
};

// Renders skill L0 (name + description), highest use_count / trust first.
const renderSkills = (skills: Skill[], cap: number): { text: string; renderedIds: string[] } => {
  const sorted = [...skills]
    .filter((s) => s.trust >= MIN_L0_TRUST)
    .sort((a, b) => b.useCount - a.useCount || b.trust - a.trust || a.name.localeCompare(b.name));
  let out = "";
  const renderedIds: string[] = [];
  for (const s of sorted) {
    const line = `- ${s.name}: ${s.description.trim()}\n`;
    if (out.length + line.length > cap) break;
    out += line;
    renderedIds.push(s.id);
  }
  return { text: out, renderedIds };
};

// Assembles the M11 memory + skills block injected into the agent system prompt.
// Returns undefined when there is nothing to inject (so composeSystemPrompt
// drops the slot entirely). Called host-side at spawn — see lifecycle.ts.
export const buildMemoryBlock = (deps: BuildMemoryBlockDeps): string | undefined => {
  const sections: string[] = [];

  const userMd = getUserMemoryPath(deps.userDataDir);
  if (existsSync(userMd)) {
    const text = readFileSync(userMd, "utf8").trim().slice(0, USER_CAP);
    if (text.length > 0) sections.push(`## About the user\n\n${text}`);
  }

  // Audit 2026-06-03 Inteligência & Contexto I5: record access for the memories
  // actually rendered into L0 (not the whole candidate set) so the ones injected
  // every turn don't decay as if unused and get pruned. Mirrors skill recordView.
  const accessedMemoryIds: string[] = [];

  const company = renderMemories(
    [
      ...deps.memoriesRepo.listCompanyGlobal(deps.companyId),
      ...deps.memoriesRepo.listForRole(deps.companyId, deps.role),
    ],
    COMPANY_CAP,
  );
  if (company.text.length > 0) sections.push(`## Company memory\n\n${company.text.trimEnd()}`);
  accessedMemoryIds.push(...company.renderedIds);

  const agent = renderMemories(deps.memoriesRepo.listByAgent(deps.agentId), AGENT_CAP);
  if (agent.text.length > 0) sections.push(`## Your memory\n\n${agent.text.trimEnd()}`);
  accessedMemoryIds.push(...agent.renderedIds);

  if (accessedMemoryIds.length > 0) deps.memoriesRepo.recordAccess(accessedMemoryIds);

  const rendered = renderSkills(
    [
      ...deps.skillsRepo.listByAgent(deps.agentId),
      ...deps.skillsRepo.listForRole(deps.companyId, deps.role),
      ...deps.skillsRepo.listCompanyGlobal(deps.companyId),
    ],
    SKILLS_CAP,
  );
  const dbSkills = rendered.text;
  if (rendered.renderedIds.length > 0) deps.skillsRepo.recordView(rendered.renderedIds);
  // The operating manual and the algorithm are bundled skills every agent
  // always has. Both are synthetic L0 entries — no DB row — whose bodies the
  // skill_read fallback serves on demand (see mcp/tools-memory.ts). Listed
  // first so the budget cannot crowd them out. The skills section therefore
  // always renders.
  const manualLine = `- ${OPERATING_MANUAL_NAME}: ${OPERATING_MANUAL_DESCRIPTION}\n`;
  const algorithmLine = `- ${ALGORITHM_NAME}: ${ALGORITHM_DESCRIPTION}\n`;
  sections.push(
    `## Your skills\n\nYou have these skills (procedural know-how). Use skill_read to load one:\n\n${(
      manualLine +
      algorithmLine +
      dbSkills
    ).trimEnd()}`,
  );

  if (sections.length === 0) return undefined;
  return `\n---\n\n# Memory & skills\n\n${sections.join("\n\n")}\n`;
};

// M11 PR-F2: true when the agent's rendered declarative memory has filled past
// 90% of its system-prompt cap — the consolidation-nudge trigger. Mirrors the
// agent slot of buildMemoryBlock (low-trust entries are excluded, as in L0).
export const agentMemoryNearFull = (memoriesRepo: MemoriesRepository, agentId: string): boolean => {
  const rendered = renderMemories(memoriesRepo.listByAgent(agentId), AGENT_CAP);
  return rendered.text.length > AGENT_CAP * 0.9;
};
