// Charter — the structured 8-section authored document that defines a role.
// Pure module: no I/O, no zod. Used by both main (validation on save) and
// renderer (live "missing sections" hint in the editor).

export const CHARTER_SECTIONS = [
  "Identity",
  "Mission & Scope",
  "Operating Workflow",
  "Domain Lenses",
  "Quality Bar",
  "Collaboration & Handoffs",
  "Safety & Limits",
  "Definition of Done",
] as const;

export type CharterSection = (typeof CHARTER_SECTIONS)[number];

export type CharterValidation = {
  ok: boolean;
  // Canonical section titles (from CHARTER_SECTIONS) that have no matching
  // `## ` heading in the document, in CHARTER_SECTIONS order.
  missing: string[];
};

// Validates that a charter markdown body contains all 8 canonical sections as
// level-2 headings. A leading "N. " number prefix is tolerated, and matching
// is case-insensitive, so "## 3. operating workflow" satisfies "Operating
// Workflow". Content under each heading is not inspected.
export const validateCharter = (body: string): CharterValidation => {
  const headings = new Set<string>();
  const re = /^##[ \t]+(.+?)[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const title = m[1]!
      .replace(/^\d+\.\s*/, "")
      .trim()
      .toLowerCase();
    headings.add(title);
  }
  const missing = CHARTER_SECTIONS.filter((s) => !headings.has(s.toLowerCase()));
  return { ok: missing.length === 0, missing };
};

// Starting point for a freshly created custom role's charter.md — the 8
// headings with a placeholder line each. Validates by construction.
export const CHARTER_SKELETON =
  ["# Role Charter", ...CHARTER_SECTIONS.map((s) => `## ${s}\n\n_Describe this section._`)].join(
    "\n\n",
  ) + "\n";
