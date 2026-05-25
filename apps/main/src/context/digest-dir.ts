// Filesystem layout for project digests. Mirrors apps/main/src/goals/isa-dir.ts:
// everything under app.getPath("userData") so the PROSPERO_USER_DATA override
// and userData relocation both work. The digest.json path is fully derived from
// companyId + projectId — the filesystem is the source of truth.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertSafePathSegment } from "../goals/isa-dir.js";

// Per-project digest directory: <userData>/companies/<cid>/projects/<pid>/  (created on access).
export const getProjectDigestDir = (
  userDataDir: string,
  companyId: string,
  projectId: string,
): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(projectId, "project id");
  const dir = join(userDataDir, "companies", companyId, "projects", projectId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Absolute digest.json path. Pure — does not create directories. Guards both ids.
export const projectDigestPath = (
  userDataDir: string,
  companyId: string,
  projectId: string,
): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(projectId, "project id");
  return join(userDataDir, "companies", companyId, "projects", projectId, "digest.json");
};

// Stable forward-slash relative path for serialization.
export const relativeDigestPath = (companyId: string, projectId: string): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(projectId, "project id");
  return `companies/${companyId}/projects/${projectId}/digest.json`;
};
