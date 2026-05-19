// TELOS — the durable 5-section artifact that defines what a company exists
// for. Pure module: no I/O, no zod. Used by main (skeleton, validation) and
// renderer (live "missing sections" hint). Mirrors packages/shared/src/isa.ts.

export const TELOS_SECTIONS = [
  "Mission",
  "Long-term Goals",
  "Principles",
  "Ideal State",
  "Non-goals",
] as const;

export type TelosSection = (typeof TELOS_SECTIONS)[number];

export type TelosValidation = {
  ok: boolean;
  // Canonical section titles with no matching `## ` heading, in TELOS_SECTIONS order.
  missing: string[];
};

// Builds a fresh telos.md body — the 5 headings with a placeholder each.
export const buildTelosSkeleton = (): string =>
  ["# Company TELOS", ...TELOS_SECTIONS.map((s) => `## ${s}\n\n_Describe this section._`)].join(
    "\n\n",
  ) + "\n";

// Starting point for a company with no TELOS. Validates by construction.
export const TELOS_SKELETON = buildTelosSkeleton();

// Validates that a telos.md body contains all 5 canonical sections as level-2
// headings. A leading "N. " prefix is tolerated; matching is case-insensitive.
export const validateTelos = (body: string): TelosValidation => {
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
  const missing = TELOS_SECTIONS.filter((s) => !headings.has(s.toLowerCase()));
  return { ok: missing.length === 0, missing };
};

// Returns the body of one section (text between its `## ` heading and the next
// `## ` heading), trimmed. Returns null when the section is absent. Tolerates a
// "N. " prefix, is case-insensitive, and normalizes CRLF before splitting.
export const getTelosSection = (body: string, section: string): string | null => {
  const target = section
    .replace(/^\d+\.\s*/, "")
    .trim()
    .toLowerCase();
  const headingRe = /^##[ \t]+(.+?)[ \t]*$/;
  let capturing = false;
  const out: string[] = [];
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const hm = headingRe.exec(line);
    if (hm !== null) {
      if (capturing) break;
      const title = hm[1]!
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
