import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DigestSection } from "@prospero/shared";
import { DIGEST_SECTIONS } from "@prospero/shared";
import { readDigest } from "../context/digest-store.js";
import { markFreshness, type FreshEntry } from "../context/freshness.js";
import { decayFactor } from "../memory/decay.js";

const MIN_DIGEST_TRUST = 0.2;
const MS_PER_DAY = 86_400_000;

const SECTION_TITLES: Record<DigestSection, string> = {
  architecture: "Architecture",
  layout: "Where things live",
  conventions: "Conventions",
  gotchas: "Gotchas",
  glossary: "Glossary",
};

// Effective trust after read-time decay (no maintenance pass needed): age since
// derivation, slowed by accessCount. Mirrors the memory decay model.
const decayedTrust = (e: FreshEntry, now: number): number => {
  const elapsedDays = Math.max(0, (now - e.derivedAt) / MS_PER_DAY);
  return e.trust * decayFactor(elapsedDays, e.accessCount);
};

// Pure renderer — takes freshness-marked entries, returns the injected markdown
// (or undefined if empty). Entries are rendered grouped by section, fresh first,
// until the cap is hit. Exported for unit testing.
export const renderProjectContextBlock = (
  entries: FreshEntry[],
  cap: number,
  now: number = Date.now(),
): string | undefined => {
  const liveEntries = entries.filter((e) => decayedTrust(e, now) >= MIN_DIGEST_TRUST);
  if (liveEntries.length === 0) return undefined;
  const ordered = [...liveEntries].sort(
    (a, b) => Number(a.stale) - Number(b.stale) || decayedTrust(b, now) - decayedTrust(a, now),
  );
  let body = "";
  for (const section of DIGEST_SECTIONS) {
    const inSection = ordered.filter((e) => e.section === section);
    if (inSection.length === 0) continue;
    const header = `\n## ${SECTION_TITLES[section]}\n\n`;
    let chunk = header;
    for (const e of inSection) {
      const flag = e.stale ? " _(possibly stale — verify before relying)_" : "";
      const line = `- ${e.body.trim()}${flag}\n`;
      if (body.length + chunk.length + line.length > cap) break;
      chunk += line;
    }
    if (chunk !== header) body += chunk; // only flush a section that got >=1 line
  }
  if (body.trim().length === 0) return undefined;
  return `\n---\n\n# Project context\n\nWhat matters about this project (distilled from prior readings). Trust it to skip re-reading, but verify anything marked stale.\n${body}`;
};

export type BuildProjectContextDeps = {
  userDataDir: string;
  companyId: string;
  projectId: string;
  projectPath: string; // absolute repo root, for resolving sourceFiles
  cap?: number;
};

const PROJECT_CONTEXT_CAP = 6144;

// Host-side entry point: load the digest, mark freshness against the live repo,
// render. Called at spawn (see orchestrator-handlers). Returns undefined when
// there is nothing to inject.
export const buildProjectContextBlock = (deps: BuildProjectContextDeps): string | undefined => {
  const digest = readDigest(deps.userDataDir, deps.companyId, deps.projectId);
  if (digest.entries.length === 0) return undefined;
  const read = (rel: string): string => {
    const abs = join(deps.projectPath, rel);
    if (!existsSync(abs)) throw new Error("missing");
    return readFileSync(abs, "utf8");
  };
  const marked = digest.entries.map((e) => markFreshness(e, read));
  return renderProjectContextBlock(marked, deps.cap ?? PROJECT_CONTEXT_CAP);
};
