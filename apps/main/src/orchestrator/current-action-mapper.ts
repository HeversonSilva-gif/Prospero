// Pure mapping from a Claude tool_use block to a short, user-facing string
// shown in the sidebar (e.g. "Reading config.json"). Never leaks raw shell
// commands, full paths, or secrets — basename + tool category only. Output
// is capped at 80 chars overall to fit the sidebar; basename further capped
// at 60 chars before composing.

const MAX_OUT = 80;
const MAX_BASENAME = 60;

const basenameOf = (p: unknown): string | null => {
  if (typeof p !== "string" || p.length === 0) return null;
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const b = lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
  if (b === "") return null;
  return b.length > MAX_BASENAME ? b.slice(0, MAX_BASENAME) + "…" : b;
};

const cap = (s: string): string => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) : s);

export const mapToolUseToAction = (name: string, input: unknown): string => {
  const inputObj =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};

  if (name === "Read") {
    const b = basenameOf(inputObj["file_path"]);
    return cap(b !== null ? `Reading ${b}` : "Reading file");
  }
  if (name === "Edit" || name === "Write" || name === "MultiEdit") {
    const b = basenameOf(inputObj["file_path"]);
    return cap(b !== null ? `Editing ${b}` : "Editing file");
  }
  if (name === "Bash") {
    // Intentionally never echo the command — leaks credentials, paths.
    return "Running shell";
  }
  if (name === "Glob" || name === "Grep") {
    return "Searching";
  }
  if (name.startsWith("mcp__dashboard__")) {
    return "Talking to dashboard";
  }
  return cap(`Using ${name}`);
};
