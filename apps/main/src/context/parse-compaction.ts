import { DIGEST_SECTIONS, type DigestSection } from "@prospero/shared";

export type ParsedKnowledge = { section: DigestSection; body: string; sourceFiles: string[] };
export type ParsedCompaction =
  | { kind: "ok"; knowledge: ParsedKnowledge[]; taskState: string }
  | { kind: "discard" };

const isSection = (s: unknown): s is DigestSection =>
  typeof s === "string" && (DIGEST_SECTIONS as readonly string[]).includes(s);

// Pull the first balanced {...} out of the text (handles fences/prose around it).
const extractJson = (text: string): string | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
};

export const parseCompactionOutput = (text: string): ParsedCompaction => {
  const json = extractJson(text);
  if (json === null) return { kind: "discard" };
  let obj: { knowledge?: unknown; taskState?: unknown };
  try {
    obj = JSON.parse(json) as typeof obj;
  } catch {
    return { kind: "discard" };
  }
  const rawK = Array.isArray(obj.knowledge) ? obj.knowledge : [];
  const knowledge: ParsedKnowledge[] = [];
  for (const item of rawK as Record<string, unknown>[]) {
    if (!isSection(item.section)) continue;
    if (typeof item.body !== "string" || item.body.trim() === "") continue;
    const files = Array.isArray(item.source_files)
      ? item.source_files.filter((f): f is string => typeof f === "string")
      : [];
    knowledge.push({ section: item.section, body: item.body.trim(), sourceFiles: files });
  }
  const taskState = typeof obj.taskState === "string" ? obj.taskState : "";
  return { kind: "ok", knowledge, taskState };
};
