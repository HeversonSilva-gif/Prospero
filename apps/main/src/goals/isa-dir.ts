// Filesystem layout for goal ISAs. Mirrors apps/main/src/agents/
// instruction-bundle-dir.ts: everything under app.getPath("userData") so the
// PROSPERO_USER_DATA override and userData relocation both work. The isa.md
// path is fully derived from companyId + goalId — the filesystem is the
// source of truth; goals.isa_path is only a presence marker.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

// A safe path segment: starts alphanumeric, then alphanumerics, hyphen,
// underscore. No dots (blocks "."/".."), no slashes. Company and goal ids are
// host-generated, so anything outside this shape means tampering — reject it.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const assertSafePathSegment = (segment: string, label: string): void => {
  if (!SAFE_SEGMENT.test(segment)) {
    throw new Error(`unsafe ${label}: ${JSON.stringify(segment)}`);
  }
};

// Per-goal ISA directory: <userData>/companies/<cid>/goals/<gid>/  (created on access).
export const getGoalIsaDir = (userDataDir: string, companyId: string, goalId: string): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(goalId, "goal id");
  const dir = join(userDataDir, "companies", companyId, "goals", goalId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Absolute isa.md path. Pure — does not create directories. Guards both ids.
export const goalIsaPath = (userDataDir: string, companyId: string, goalId: string): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(goalId, "goal id");
  return join(userDataDir, "companies", companyId, "goals", goalId, "isa.md");
};

// Stable forward-slash relative path stored in goals.isa_path as a marker.
export const relativeIsaPath = (companyId: string, goalId: string): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(goalId, "goal id");
  return `companies/${companyId}/goals/${goalId}/isa.md`;
};
