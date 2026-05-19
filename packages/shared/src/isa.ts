// ISA (Ideal State Artifact) — the structured 8-section document that defines
// what "done" means for a goal. Pure module: no I/O, no zod. Used by main
// (skeleton, validation) and renderer (live "missing sections" hint).
// Mirrors packages/shared/src/charter.ts.

export const ISA_SECTIONS = [
  "Problem",
  "Vision",
  "Out of Scope",
  "Constraints",
  "Criteria",
  "Verification Plan",
  "Decisions",
  "Changelog",
] as const;

export type IsaSection = (typeof ISA_SECTIONS)[number];

export type IsaValidation = {
  ok: boolean;
  // Canonical section titles with no matching `## ` heading, in ISA_SECTIONS order.
  missing: string[];
};

// Sections 5 (Criteria) and 6 (Verification Plan) are rendered from the
// goal_criteria table — the file only carries a placeholder for them.
const ISC_PLACEHOLDER = "<!-- ISCs — managed in the ISA panel criteria list. -->";

// Builds a fresh isa.md body. When `vision` is supplied (migrating an existing
// goal's success_criteria), it seeds the Vision section.
export const buildIsaSkeleton = (opts: { vision?: string } = {}): string => {
  const sectionBody = (name: IsaSection): string => {
    if (name === "Vision" && opts.vision !== undefined && opts.vision.trim() !== "") {
      return opts.vision.trim();
    }
    if (name === "Criteria" || name === "Verification Plan") return ISC_PLACEHOLDER;
    return "_Describe this section._";
  };
  return (
    ["# Ideal State Artifact", ...ISA_SECTIONS.map((s) => `## ${s}\n\n${sectionBody(s)}`)].join(
      "\n\n",
    ) + "\n"
  );
};

// Starting point for a goal with no success_criteria. Validates by construction.
export const ISA_SKELETON = buildIsaSkeleton();

// Validates that an isa.md body contains all 8 canonical sections as level-2
// headings. A leading "N. " prefix is tolerated; matching is case-insensitive.
export const validateIsa = (body: string): IsaValidation => {
  const headings = new Set<string>();
  const re = /^##[ \t]+(.+?)[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    headings.add(
      m[1]!
        .replace(/^\d+\.\s*/, "")
        .trim()
        .toLowerCase(),
    );
  }
  const missing = ISA_SECTIONS.filter((s) => !headings.has(s.toLowerCase()));
  return { ok: missing.length === 0, missing };
};

// Returns the body of one section (text between its `## ` heading and the next
// `## ` heading), trimmed. Returns null when the section is absent. The match
// tolerates a "N. " prefix and is case-insensitive.
export const getIsaSection = (body: string, section: string): string | null => {
  const target = section
    .replace(/^\d+\.\s*/, "")
    .trim()
    .toLowerCase();
  const headingRe = /^##[ \t]+(.+?)[ \t]*$/;
  let capturing = false;
  const out: string[] = [];
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const m = headingRe.exec(line);
    if (m !== null) {
      if (capturing) break;
      const title = m[1]!
        .replace(/^\d+\.\s*/, "")
        .trim()
        .toLowerCase();
      if (title === target) {
        capturing = true;
      }
      continue;
    }
    if (capturing) out.push(line);
  }
  return capturing ? out.join("\n").trim() : null;
};
