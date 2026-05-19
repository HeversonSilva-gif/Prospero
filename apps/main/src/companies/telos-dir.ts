// Filesystem layout for a company's TELOS. Mirrors apps/main/src/goals/
// isa-dir.ts: everything under app.getPath("userData"). The telos.md path is
// derived from companyId — the filesystem is the source of truth; the
// companies.telos_path column is only a presence marker.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

// A safe path segment: starts alphanumeric, then alphanumerics, hyphen,
// underscore. No dots (blocks "."/".."), no slashes. Company ids are
// host-generated, so anything outside this shape means tampering — reject it.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const assertSafePathSegment = (segment: string, label: string): void => {
  if (!SAFE_SEGMENT.test(segment)) {
    throw new Error(`unsafe ${label}: ${JSON.stringify(segment)}`);
  }
};

// Per-company directory: <userData>/companies/<cid>/  (created on access).
export const getCompanyDir = (userDataDir: string, companyId: string): string => {
  assertSafePathSegment(companyId, "company id");
  const dir = join(userDataDir, "companies", companyId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Absolute telos.md path. Pure — does not create directories. Guards the id.
export const companyTelosPath = (userDataDir: string, companyId: string): string => {
  assertSafePathSegment(companyId, "company id");
  return join(userDataDir, "companies", companyId, "telos.md");
};

// Stable forward-slash relative path stored in companies.telos_path as a marker.
export const relativeTelosPath = (companyId: string): string => {
  assertSafePathSegment(companyId, "company id");
  return `companies/${companyId}/telos.md`;
};
