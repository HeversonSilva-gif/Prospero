// Fase 1/2 Memória de Contexto — shared types for the live project digest (digest.json).

export const DIGEST_SECTIONS = [
  "architecture",
  "layout",
  "conventions",
  "gotchas",
  "glossary",
] as const;

export type DigestSection = (typeof DIGEST_SECTIONS)[number];

// Trust/decay fields (Fase 2) mirror the memory model: trust gates injection,
// accessCount slows decay, lastAccessed/derivedAt drive read-time decay.
export interface DigestEntry {
  id: string;
  section: DigestSection;
  body: string;
  sourceFiles: string[];
  contentHash: string;
  derivedAt: number;
  trust: number; // 0..1
  accessCount: number;
  lastAccessed: number | null;
}

// A deeper, per-area note (Fase 2) — longer than a map entry, loaded on demand
// via project_context_read, authored/corrected via project_context_note.
export interface DeepDive {
  id: string;
  area: string;
  body: string;
  sourceFiles: string[];
  contentHash: string;
  derivedAt: number;
  trust: number;
  accessCount: number;
  lastAccessed: number | null;
}

export interface ProjectDigest {
  version: 1;
  entries: DigestEntry[];
  deepDives: DeepDive[];
}

export const emptyDigest = (): ProjectDigest => ({ version: 1, entries: [], deepDives: [] });
