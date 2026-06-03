import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProjectDigest, DigestEntry, DeepDive } from "@prospero/shared";
import { emptyDigest } from "@prospero/shared";
import { getProjectDigestDir, projectDigestPath } from "./digest-dir.js";

const num = (v: unknown, dflt: number): number => (typeof v === "number" ? v : dflt);

const normEntry = (e: Record<string, unknown>): DigestEntry => {
  const id = typeof e.id === "string" ? e.id : "";
  const body = typeof e.body === "string" ? e.body : "";
  const contentHash = typeof e.contentHash === "string" ? e.contentHash : "";
  return {
    id,
    section: e.section as DigestEntry["section"],
    body,
    sourceFiles: Array.isArray(e.sourceFiles) ? (e.sourceFiles as string[]) : [],
    contentHash,
    derivedAt: num(e.derivedAt, 0),
    trust: num(e.trust, 0.5),
    accessCount: num(e.accessCount, 0),
    lastAccessed: typeof e.lastAccessed === "number" ? e.lastAccessed : null,
  };
};

const normDeep = (d: Record<string, unknown>): DeepDive => {
  const id = typeof d.id === "string" ? d.id : "";
  const area = typeof d.area === "string" ? d.area : "";
  const body = typeof d.body === "string" ? d.body : "";
  const contentHash = typeof d.contentHash === "string" ? d.contentHash : "";
  return {
    id,
    area,
    body,
    sourceFiles: Array.isArray(d.sourceFiles) ? (d.sourceFiles as string[]) : [],
    contentHash,
    derivedAt: num(d.derivedAt, 0),
    trust: num(d.trust, 0.5),
    accessCount: num(d.accessCount, 0),
    lastAccessed: typeof d.lastAccessed === "number" ? d.lastAccessed : null,
  };
};

// --- Path-based core (target-agnostic) ---------------------------------------
// readDigest/writeDigest below resolve a PROJECT path and delegate to these. The
// compaction worker + respawn injection (v0.2.4) call these directly with an
// already-resolved path so they can target either a project digest OR an
// agent-scoped digest (CEO / multi-project agents) with one code path.

// Read a digest from an absolute path. Missing/corrupt → empty digest (never throws).
export const readDigestAt = (path: string): ProjectDigest => {
  if (!existsSync(path)) return emptyDigest();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ProjectDigest;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return emptyDigest();
    return {
      version: 1,
      entries: (parsed.entries as unknown as Record<string, unknown>[]).map(normEntry),
      deepDives: Array.isArray(parsed.deepDives)
        ? (parsed.deepDives as unknown as Record<string, unknown>[]).map(normDeep)
        : [],
    };
  } catch {
    // A corrupt digest must never crash a spawn — treat as empty.
    return emptyDigest();
  }
};

// Write a digest to an absolute path, creating its parent directory.
export const writeDigestAt = (path: string, digest: ProjectDigest): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(digest, null, 2), "utf8");
};

export const readDigest = (
  userDataDir: string,
  companyId: string,
  projectId: string,
): ProjectDigest => readDigestAt(projectDigestPath(userDataDir, companyId, projectId));

export const writeDigest = (
  userDataDir: string,
  companyId: string,
  projectId: string,
  digest: ProjectDigest,
): void => {
  getProjectDigestDir(userDataDir, companyId, projectId); // ensure dir
  writeDigestAt(projectDigestPath(userDataDir, companyId, projectId), digest);
};

// Two entries describe "the same thing" when they share a section and the exact
// same source-file set — incoming then supersedes (a refresh). Otherwise the
// incoming entry is appended.
const sameTarget = (a: DigestEntry, b: DigestEntry): boolean =>
  a.section === b.section &&
  a.sourceFiles.length === b.sourceFiles.length &&
  [...a.sourceFiles].sort().join("|") === [...b.sourceFiles].sort().join("|");

export const foldEntries = (base: DigestEntry[], incoming: DigestEntry[]): DigestEntry[] => {
  const out = [...base];
  for (const inc of incoming) {
    const idx = out.findIndex((e) => sameTarget(e, inc));
    if (idx >= 0) out[idx] = inc;
    else out.push(inc);
  }
  return out;
};

export const foldDeepDives = (base: DeepDive[], incoming: DeepDive[]): DeepDive[] => {
  const out = [...base];
  for (const inc of incoming) {
    const idx = out.findIndex((d) => d.area === inc.area);
    if (idx >= 0) out[idx] = inc;
    else out.push(inc);
  }
  return out;
};

export const bumpEntryAccess = <T extends { accessCount: number; lastAccessed: number | null }>(
  entry: T,
  now: number,
): T => ({ ...entry, accessCount: entry.accessCount + 1, lastAccessed: now });

// Audit 2026-06-03 Inteligência & Contexto I6: bump access on the map entries
// actually injected into a prompt, mirroring bumpEntryAccess for deep-dives.
// Reads the digest at `path`, increments accessCount + stamps lastAccessed on the
// listed entry ids, and writes it back. No-op (no write) when ids is empty.
export const bumpEntriesAtPath = (path: string, ids: string[], now: number): void => {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const digest = readDigestAt(path);
  let changed = false;
  const entries = digest.entries.map((e) => {
    if (!idSet.has(e.id)) return e;
    changed = true;
    return bumpEntryAccess(e, now);
  });
  if (!changed) return;
  writeDigestAt(path, { ...digest, entries });
};
