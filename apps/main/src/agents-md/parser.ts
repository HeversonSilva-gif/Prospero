import matter from "gray-matter";
import { AgentsMdSchema, type AgentsMdPayload } from "./schema.js";

// PR-F.2.2: parse AGENTS.md YAML front-matter using gray-matter + zod.
// Returns a tagged result: { ok: true, data } or { ok: false, error }.
// Free-text body after the `---` close is discarded.

export type ParseResult = { ok: true; data: AgentsMdPayload } | { ok: false; error: string };

export const parseAgentsMd = (raw: string): ParseResult => {
  let frontMatter: unknown;
  try {
    const parsed = matter(raw);
    frontMatter = parsed.data;
  } catch (err) {
    return { ok: false, error: `YAML parse failed: ${(err as Error).message}` };
  }

  const result = AgentsMdSchema.safeParse(frontMatter);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".") ?? "(root)";
    return { ok: false, error: `${path}: ${first?.message ?? "shape mismatch"}` };
  }
  return { ok: true, data: result.data };
};
