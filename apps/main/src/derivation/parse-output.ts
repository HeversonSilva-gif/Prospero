// A skill proposal extracted from a derivation run.
export type DerivationDraft = {
  name: string;
  description: string;
  body: string;
};

export type ParsedDerivation = { kind: "skill"; draft: DerivationDraft } | { kind: "discard" };

const JSON_BLOCK = /```json\s*([\s\S]*?)```/;

// Coerces a model-proposed name into a safe kebab-case id.
const toKebab = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Parses the runner's text output. Anything that is not a well-formed JSON
// skill block — including the literal "DISCARD" — is a discard. The derivation
// is untrusted LLM output, so the parser never throws.
export const parseDerivationOutput = (text: string): ParsedDerivation => {
  const match = JSON_BLOCK.exec(text);
  if (match === null) return { kind: "discard" };
  const inner = match[1];
  if (inner === undefined) return { kind: "discard" };
  let obj: unknown;
  try {
    obj = JSON.parse(inner.trim());
  } catch {
    return { kind: "discard" };
  }
  if (typeof obj !== "object" || obj === null) return { kind: "discard" };
  const rec = obj as Record<string, unknown>;
  const name = typeof rec["name"] === "string" ? toKebab(rec["name"]) : "";
  const description = typeof rec["description"] === "string" ? rec["description"].trim() : "";
  const body = typeof rec["body"] === "string" ? rec["body"].trim() : "";
  if (name === "" || description === "" || body === "") return { kind: "discard" };
  return {
    kind: "skill",
    draft: { name, description: description.slice(0, 200), body },
  };
};
