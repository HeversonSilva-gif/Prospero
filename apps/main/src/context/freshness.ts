import { createHash } from "node:crypto";
import type { DigestEntry } from "@prospero/shared";

export type ReadFile = (relPath: string) => string;

// A content hash over a set of files, independent of order. A file that can't be
// read contributes a sentinel so a deleted/moved source still changes the hash.
export const hashSources = (sourceFiles: string[], read: ReadFile): string => {
  const h = createHash("sha256");
  for (const f of [...sourceFiles].sort()) {
    let content: string;
    try {
      content = read(f);
    } catch {
      content = " MISSING ";
    }
    h.update(f);
    h.update(" ");
    h.update(content);
    h.update(" ");
  }
  return h.digest("hex");
};

export type FreshEntry = DigestEntry & { stale: boolean };

// Re-hashes the entry's current sources and compares to the stored hash.
export const markFreshness = (entry: DigestEntry, read: ReadFile): FreshEntry => ({
  ...entry,
  stale: hashSources(entry.sourceFiles, read) !== entry.contentHash,
});
