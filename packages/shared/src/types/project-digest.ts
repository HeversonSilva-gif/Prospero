// The "map" tiers — the small, always-injected top-level digest. Deep-dives
// (per-area, on-demand) arrive in Phase 2.
export const DIGEST_SECTIONS = [
  "architecture", // how the system splits
  "layout", // where things live (key dirs/modules)
  "conventions", // patterns this codebase follows
  "gotchas", // traps (ABI, exactOptionalPropertyTypes, etc.)
  "glossary", // domain terms
] as const;

export type DigestSection = (typeof DIGEST_SECTIONS)[number];

// One distilled fact about the project, with provenance so freshness can be
// checked: sourceFiles are repo-relative paths the fact was derived from, and
// contentHash is a hash of those files' contents at derivation time.
export type DigestEntry = {
  id: string;
  section: DigestSection;
  body: string;
  sourceFiles: string[];
  contentHash: string;
  derivedAt: number;
};

export type ProjectDigest = {
  version: 1;
  entries: DigestEntry[];
};

export const emptyDigest = (): ProjectDigest => ({ version: 1, entries: [] });
