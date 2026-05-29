// Containment zones (M13 PR-E, spec §9). Declares a privacy zone for each
// known directory under <userData>; gate.ts consults zoneOf + canAccess to
// block cross-zone access and audit it via `security.zone_blocked`. Pure
// module — no I/O, no DB. Defense-in-depth on top of the M6.1 sandbox CWD.
//
// First-cut classifier coverage (confirmed by grepping the source):
//
//   companies/<cid>/agents/<aid>/...
//     → agent zone   (M6.1 agent CWD)
//
//   companies/<cid>/<...else...>
//     → company zone (telos.md, goals/<gid>/isa.md)
//
//   agent-instructions/companies/<cid>/agents/<aid>/...
//     → agent zone   (M12 PR-C instruction bundles)
//     NOTE: real layout uses the "agent-instructions/" prefix, NOT a flat
//     companies/<cid>/agents/<aid>/ tree as the plan assumed. Classifier
//     adjusted accordingly.
//
//   memory/companies/<cid>/agents/<aid>/...
//     → agent zone   (M11 per-agent memory/skills)
//     NOTE: real layout uses the "memory/" prefix, NOT a flat
//     companies/<cid>/agents/<aid>/ tree as the plan assumed. Classifier
//     adjusted accordingly.
//
//   memory/companies/<cid>/<...else...>
//     → company zone (M11 company-shared memory/skills)
//
//   anything else → null (no opinion; gate defers to path-fence)
//
// The `shared` and `system` variants are defined for spec parity but the
// classifier never returns them today — company-shared skills and the role
// library live in SQLite (M12 PR-A), and no agent FS tool path touches a
// path we'd want to flag as "system".

import { relative, sep } from "node:path";
import type { Agent } from "@prospero/shared";

export type ZoneId =
  | { kind: "company"; companyId: string }
  | { kind: "agent"; companyId: string; agentId: string }
  | { kind: "shared" }
  | { kind: "system" };

// Classify the part of the path that begins with "companies/<cid>/..."
// (the common suffix across all three prefix trees).
// `parts` starts at "companies" (index 0). Returns null if not long enough.
const classifyCompaniesSubpath = (parts: string[]): ZoneId | null => {
  // parts[0] === "companies"
  if (parts.length < 2) return null;
  const companyId = parts[1];
  if (!companyId) return null;
  // agents/<aid>/ sub-tree → agent zone
  if (parts.length >= 4 && parts[2] === "agents") {
    const agentId = parts[3];
    if (!agentId) return null;
    return { kind: "agent", companyId, agentId };
  }
  // anything else under this company → company zone
  return { kind: "company", companyId };
};

// Classifies an absolute path under <userData>. Returns null for paths the
// zone system has no opinion on — gate.ts then defers entirely to the
// existing path-fence for those.
export const zoneOf = (absPath: string, userDataDir: string): ZoneId | null => {
  const rel = relative(userDataDir, absPath);
  // relative() returns "" for the dir itself; ".." prefix means outside.
  if (rel === "" || rel.startsWith("..")) return null;
  const parts = rel.split(sep).filter((p) => p !== "");
  if (parts.length === 0) return null;

  const prefix = parts[0];

  // ── sbx/<slug>/... (and legacy agent-sandbox/<aid>/...) ───────────────────
  // Per-agent sandbox: config dir + CWD. Holds CLAUDE_CONFIG_DIR/.credentials.json
  // (seeded OAuth token), sandbox settings.json and per-session resume/projects
  // data. No agent FS tool should ever touch it — classify as "system" so every
  // access is denied + audited regardless of allowedProjectPaths (iss_0d783928).
  // `sbx` is the short v0.1.38 layout (MAX_PATH fix); `agent-sandbox` is the
  // pre-upgrade layout — kept recognized so orphaned old dirs stay protected.
  if (prefix === "sbx" || prefix === "agent-sandbox") {
    return { kind: "system" };
  }

  // ── companies/<cid>/... ────────────────────────────────────────────────────
  if (prefix === "companies") {
    return classifyCompaniesSubpath(parts);
  }

  // ── agent-instructions/companies/<cid>/... ────────────────────────────────
  // (M12 PR-C instruction bundles)
  if (prefix === "agent-instructions" && parts[1] === "companies") {
    return classifyCompaniesSubpath(parts.slice(1));
  }

  // ── memory/companies/<cid>/... ────────────────────────────────────────────
  // (M11 per-agent and company-shared memory/skills)
  if (prefix === "memory" && parts[1] === "companies") {
    return classifyCompaniesSubpath(parts.slice(1));
  }

  return null;
};

// True iff `actor` may touch a file whose target zone is `zone`. Per spec §9:
//   - own `agent` zone: yes
//   - own `company` zone: yes
//   - `shared`: yes (meant to be readable by any agent)
//   - any other agent / any other company / `system`: no
export const canAccess = (
  actor: { companyId: string; id: string } | Agent,
  zone: ZoneId,
): boolean => {
  switch (zone.kind) {
    case "agent":
      return zone.companyId === actor.companyId && zone.agentId === actor.id;
    case "company":
      return zone.companyId === actor.companyId;
    case "shared":
      return true;
    case "system":
      return false;
  }
};
