import type { SkillProposalKind } from "@prospero/shared";

export type ParsedProposal = {
  kind: SkillProposalKind;
  sourceSkillIds: string[];
  name: string | null;
  description: string | null;
  body: string | null;
  rationale: string;
};

const stripFence = (text: string): string => {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1]!.trim() : text.trim();
};

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

// Parses + validates fork output, dropping any malformed entry (mirrors the
// discard semantics of derivation/parse-output.ts). `known` = the skill ids that
// currently exist for the company; an entry naming an unknown id is dropped.
// merge/patch require name+body; merge requires >=2 source ids.
export const parseProposals = (text: string, known: Set<string>): ParsedProposal[] => {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: ParsedProposal[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const kind = o["kind"];
    if (kind !== "merge" && kind !== "patch" && kind !== "archive") continue;
    if (!isStringArray(o["sourceSkillIds"]) || o["sourceSkillIds"].length === 0) continue;
    if (!o["sourceSkillIds"].every((id) => known.has(id))) continue;
    if (typeof o["rationale"] !== "string" || o["rationale"].trim() === "") continue;
    const name = typeof o["name"] === "string" ? o["name"] : null;
    const description = typeof o["description"] === "string" ? o["description"] : null;
    const body = typeof o["body"] === "string" ? o["body"] : null;
    if ((kind === "merge" || kind === "patch") && (name === null || body === null)) continue;
    if (kind === "merge" && o["sourceSkillIds"].length < 2) continue;
    out.push({
      kind,
      sourceSkillIds: o["sourceSkillIds"],
      name,
      description,
      body,
      rationale: o["rationale"],
    });
  }
  return out;
};
