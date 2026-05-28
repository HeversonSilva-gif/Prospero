import type { SkillLifecycleState } from "@prospero/shared";

export type LibrarianSkill = {
  id: string;
  name: string;
  description: string;
  useCount: number;
  viewCount: number;
  patchCount: number;
  trust: number;
  lifecycleState: SkillLifecycleState;
  body: string;
};

const BODY_PREVIEW = 600;

// Builds the headless prompt for the weekly library review. The fork must reply
// with ONLY a JSON array of proposals (no prose), each:
//   { kind: "merge"|"patch"|"archive", sourceSkillIds: [..], name?, description?, body?, rationale }
// merge/patch require name+body; merge requires >=2 source ids.
export const buildLibrarianPrompt = (skills: LibrarianSkill[]): string => {
  const catalog = skills
    .map(
      (s) =>
        `### ${s.id} — ${s.name} [${s.lifecycleState}]\n` +
        `description: ${s.description}\n` +
        `use=${s.useCount} view=${s.viewCount} patch=${s.patchCount} trust=${s.trust.toFixed(2)}\n` +
        `body:\n${s.body.slice(0, BODY_PREVIEW)}\n`,
    )
    .join("\n");

  return [
    "You are the skill librarian for an autonomous software team. Review this",
    "skill library and propose consolidations that keep it lean and current.",
    "",
    "Look for:",
    "- merge: two or more skills that overlap so much they should be one.",
    "- patch: a skill whose body is outdated or could be sharpened.",
    "- archive: a skill that is low-value and should be retired (e.g. high view",
    "  count but never used — surfaced but useless).",
    "",
    "Be conservative: only propose a change you are confident improves the library.",
    "It is fine to propose nothing (reply with []).",
    "",
    "Reply with ONLY a JSON array (no prose, no code fence). Each element:",
    '{ "kind": "merge"|"patch"|"archive", "sourceSkillIds": ["id", ...],',
    '  "name": "...", "description": "...", "body": "full new SKILL.md", "rationale": "..." }',
    'For "merge" give >=2 sourceSkillIds plus name+description+body of the combined',
    'skill. For "patch" give the single sourceSkillId plus the new name/description/body.',
    'For "archive" give the sourceSkillId(s) and a rationale; name/description/body may be omitted.',
    "",
    "## Skill library",
    "",
    catalog,
  ].join("\n");
};
