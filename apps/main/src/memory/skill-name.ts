// Shared skill-name validation rule — mirrors the constraint in skill_create
// (tools-memory.ts) so that every write path (MCP tool, review-candidate,
// apply-proposal) enforces the same kebab-case invariant.
//
// Rule: 1-120 characters, lowercase letters / digits / hyphens only.
// This also prevents path traversal via `..` or any path separator.
const SKILL_NAME_RE = /^[a-z0-9-]+$/;
const SKILL_NAME_MAX = 120;

export const assertValidSkillName = (name: string): void => {
  if (name.length === 0 || name.length > SKILL_NAME_MAX) {
    throw new Error(
      `skill name must be 1-${SKILL_NAME_MAX} characters, got "${name}" (${name.length} chars)`,
    );
  }
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`skill name must be lowercase kebab-case ([a-z0-9-]), got "${name}"`);
  }
};
