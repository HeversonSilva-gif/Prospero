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

// --- Agent-scoped digest (v0.2.4) --------------------------------------------
// An agent whose allowedProjects is `[]` (= all projects, the CEO's normal
// scope) or multiple projects has no single project to fold into. Its compaction
// digest lives under the AGENT instead of a project, so the CEO compacts AND
// gets a durable digest re-injected. Mirrors the project layout exactly (same
// assertSafePathSegment guard).

// Per-agent digest directory: <userData>/companies/<cid>/agents/<aid>/  (created on access).
export const getAgentDigestDir = (
  userDataDir: string,
  companyId: string,
  agentId: string,
): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(agentId, "agent id");
  const dir = join(userDataDir, "companies", companyId, "agents", agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Absolute agent digest.json path. Pure — does not create directories. Guards both ids.
export const agentDigestPath = (
  userDataDir: string,
  companyId: string,
  agentId: string,
): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(agentId, "agent id");
  return join(userDataDir, "companies", companyId, "agents", agentId, "digest.json");
};

// Stable forward-slash relative path for serialization.
export const relativeAgentDigestPath = (companyId: string, agentId: string): string => {
  assertSafePathSegment(companyId, "company id");
  assertSafePathSegment(agentId, "agent id");
  return `companies/${companyId}/agents/${agentId}/digest.json`;
};
