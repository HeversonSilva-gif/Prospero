import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ProjectDigest, DigestEntry } from "@prospero/shared";
import { emptyDigest } from "@prospero/shared";
import { getProjectDigestDir, projectDigestPath } from "./digest-dir.js";

export const readDigest = (
  userDataDir: string,
  companyId: string,
  projectId: string,
): ProjectDigest => {
  const path = projectDigestPath(userDataDir, companyId, projectId);
  if (!existsSync(path)) return emptyDigest();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ProjectDigest;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return emptyDigest();
    return parsed;
  } catch {
    // A corrupt digest must never crash a spawn — treat as empty.
    return emptyDigest();
  }
};

export const writeDigest = (
  userDataDir: string,
  companyId: string,
  projectId: string,
  digest: ProjectDigest,
): void => {
  getProjectDigestDir(userDataDir, companyId, projectId); // ensure dir
  writeFileSync(
    projectDigestPath(userDataDir, companyId, projectId),
    JSON.stringify(digest, null, 2),
    "utf8",
  );
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
