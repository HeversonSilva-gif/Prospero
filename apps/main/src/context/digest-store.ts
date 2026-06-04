import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, basename, join } from "node:path";
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

// Per-process counter so two concurrent writers in THIS process never pick the same
// temp name (combined with the pid it is also unique across processes).
let tmpSeq = 0;

// Renames `from` over `to`, retrying a few times on the transient Windows lock errors
// that happen when a concurrent reader (MAIN vs the MCP child) has the target open for a
// fast readFileSync. The competing read is microseconds, so immediate retries clear it.
const renameWithRetry = (from: string, to: string): void => {
  const MAX = 5;
  for (let i = 0; i < MAX; i += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i < MAX - 1 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) continue;
      throw err;
    }
  }
};

// Audit 2026-06-03 Inteligência & Contexto (review backlog): MAIN and the MCP child both
// read-modify-write the SAME digest.json (compaction worker, bumpEntriesAtPath). A plain
// writeFileSync can be observed half-written by the other side (torn read → corrupt JSON →
// the whole digest is dropped for that spawn). Write to a sibling temp file then rename
// over the target: rename is atomic, so a concurrent reader sees either the old file or the
// new one, never a partial. Fail-safe: if the atomic path fails outright (e.g. Windows held
// the target locked through every retry), fall back to a direct write so a digest update is
// never silently lost — no worse than the pre-atomic behavior.
export const writeDigestAt = (path: string, digest: ProjectDigest): void => {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const data = JSON.stringify(digest, null, 2);
  const tmp = join(dir, `.${basename(path)}.${String(process.pid)}.${String(tmpSeq++)}.tmp`);
  try {
    writeFileSync(tmp, data, "utf8");
    renameWithRetry(tmp, path);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // temp never created / already gone — nothing to clean up.
    }
    writeFileSync(path, data, "utf8");
  }
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

// Generous cap on the number of digest entries kept on disk. Injection is
// already bounded to ~6144 chars (~30-50 entries) by trust decay, so this cap is
// far above what is ever surfaced — it only stops the JSON from growing
// unbounded across many compactions. Pruning above it can't lose knowledge that
// would have been injected.
const DIGEST_ENTRY_CAP = 300;

// Value ranking for pruning: trust dominates, then how often the entry has
// proven useful (accessCount), then how recently it was derived (freshness).
// Mirrors the spirit of the injection ranking without needing a clock.
const byValueDesc = (a: DigestEntry, b: DigestEntry): number =>
  b.trust - a.trust || b.accessCount - a.accessCount || b.derivedAt - a.derivedAt;

export const foldEntries = (base: DigestEntry[], incoming: DigestEntry[]): DigestEntry[] => {
  const out = [...base];
  const freshIds = new Set<string>();
  for (const inc of incoming) {
    const idx = out.findIndex((e) => sameTarget(e, inc));
    if (idx >= 0) out[idx] = inc;
    else {
      out.push(inc);
      freshIds.add(inc.id);
    }
  }
  if (out.length <= DIGEST_ENTRY_CAP) return out;
  // Over the cap: ALWAYS keep this batch's freshly-appended entries (just-learned
  // knowledge must land), then fill the remaining slots with the highest-value
  // older entries and drop the rest. Result preserves the original order.
  const older = out.filter((e) => !freshIds.has(e.id)).sort(byValueDesc);
  const keepOlder = new Set(
    older.slice(0, Math.max(0, DIGEST_ENTRY_CAP - freshIds.size)).map((e) => e.id),
  );
  return out.filter((e) => freshIds.has(e.id) || keepOlder.has(e.id));
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
