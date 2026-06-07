// Client-side Read / Glob / Grep for the SDK-based `claude-api-direct` adapter.
//
// WHY THIS EXISTS: the CLI adapter gets Read/Glob/Grep for free from Claude
// Code. The SDK adapter has no built-in file tools, so the CEO (which holds the
// `fs-read` capability and uses it to read project files by absolute path — the
// operating manual itself is served by the skill_read MCP tool, not the FS) would
// lose its ability to inspect files — making it dumber. These tools restore that
// ability for the SDK path.
//
// SECURITY MODEL — we REUSE the existing gate, we do NOT invent new logic.
// Every path the tool touches is run through `evaluatePermission` from
// `../../../security/gate.js`, the exact same boundary the CLI enforces
// (always-blocked blocklist + path-fence `isInsideAnyAllowed` + containment
// zones). Read/Glob/Grep are read-only and auto-allow ONLY AFTER passing those
// fences.
//
// ENUMERATION SAFETY (the subtle part): `evaluatePermission` only inspects the
// INPUT path. Read passes a single `file_path`, so one gate call fully covers
// it. But Glob/Grep enumerate MANY files. We defend the enumeration on TWO
// layers:
//   1. We gate the requested ROOT (`path ?? agentCwd`) up front via
//      evaluatePermission. If the root is outside the boundary the whole call
//      is denied before any directory is opened.
//   2. We CONFINE enumeration to that already-gated root: the recursive walker
//      never escapes it, and EVERY file we are about to open is re-checked with
//      `evaluatePermission({ toolName: "Read", toolInput: { file_path } })`.
//      A file that fails the gate (e.g. a symlink pointing outside, or a
//      blocklisted sensitive name like `.credentials.json` nested inside an
//      allowed dir) is silently skipped, never read. This makes the gate — not
//      this module — the single source of truth for the boundary.

import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import { resolve, isAbsolute, join, relative, sep } from "node:path";
import type { Agent } from "@prospero/shared";
import { evaluatePermission } from "../../../security/gate.js";
import { matchesBlockedPath } from "../../../security/blocklist.js";
import { zoneOf, canAccess } from "../../../security/zones.js";
import type { SdkToolDef } from "./tool-bridge.js";

export type FsSecCtx = {
  agent: Agent;
  allowedProjectPaths: string[];
  agentCwd: string;
  userDataDir: string;
};

const MAX_OUTPUT_CHARS = 100_000;
const MAX_GLOB_RESULTS = 200;
const MAX_GREP_RESULTS = 200;
// Bound enumeration so a Glob/Grep over a huge tree can't hang the loop or
// blow memory. The path-fence already confines us to the project; this just
// caps the walk.
const MAX_FILES_WALKED = 20_000;

const FS_TOOL_NAMES = new Set(["Read", "Glob", "Grep"]);

export const isFsTool = (name: string): boolean => FS_TOOL_NAMES.has(name);

export const fsToolDefs = (): SdkToolDef[] => [
  {
    name: "Read",
    description:
      "Read a file from the local filesystem. file_path may be absolute or relative to the " +
      "working directory. Optional offset (1-based start line) and limit (max lines) read a " +
      "slice. Only files inside the allowed project boundary can be read.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file to read." },
        offset: { type: "number", description: "1-based line number to start reading from." },
        limit: { type: "number", description: "Maximum number of lines to read." },
      },
      required: ["file_path"],
    },
  },
  {
    name: "Glob",
    description:
      'Find files matching a glob pattern (e.g. "**/*.ts", "src/*.md"). Searches under ' +
      "`path` if given, otherwise the working directory. Returns newline-joined matching file " +
      "paths. Only files inside the allowed project boundary are returned.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match file paths against." },
        path: { type: "string", description: "Directory to search in. Defaults to the cwd." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description:
      "Search file contents for a regular expression. Searches under `path` if given, otherwise " +
      "the working directory, optionally filtered to files matching `glob`. Returns matching " +
      "`file:line:text` lines. Only files inside the allowed project boundary are searched.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for." },
        path: { type: "string", description: "Directory to search in. Defaults to the cwd." },
        glob: { type: "string", description: "Only search files matching this glob pattern." },
      },
      required: ["pattern"],
    },
  },
];

const asObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const cap = (s: string): string =>
  s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + "\n[…truncated]" : s;

// Single chokepoint to the gate. Returns the deny string when the gate rejects
// the (toolName, path) pair, or undefined when allowed. Used both for the
// top-level call and for re-checking each enumerated file.
const gateDeny = (sec: FsSecCtx, toolName: string, toolInput: unknown): string | undefined => {
  const decision = evaluatePermission({
    toolName,
    toolInput,
    agent: sec.agent,
    allowedProjectPaths: sec.allowedProjectPaths,
    agentCwd: sec.agentCwd,
    userDataDir: sec.userDataDir,
  });
  return decision.action === "allow" ? undefined : "[denied] " + (decision.reason ?? "denied");
};

// Pure, side-effect-FREE per-file boundary check for enumerated files (Glob/Grep).
// The requested ROOT is already gated via the full `evaluatePermission` (one audit
// record), and the walk is confined to that root with symlinks skipped — so the
// path-fence is already guaranteed for every enumerated file. Using the full gate
// PER FILE would record a `trust.readonly_autoapproved` activity event for each of
// potentially thousands of files (flooding the activity stream + DB). So per file we
// reuse only the gate's PURE pieces — the always-blocked blocklist (so a nested
// `.env`/`.credentials.json` is never surfaced) and the containment-zone check (so a
// company-zone search can't leak another agent's files) — with no recording.
const fileWithinBoundary = (file: string, sec: FsSecCtx): boolean => {
  if (matchesBlockedPath(file)) return false;
  const zone = zoneOf(file, sec.userDataDir);
  return zone === null || canAccess(sec.agent, zone);
};

// ── Minimal glob → RegExp. Dependency-light (no tinyglobby). Supports the
// subset agents actually use: `**` (any path segments), `*` (any chars except
// the path separator), `?` (one char), and literal segments. Matching is done
// against POSIX-normalized relative paths so patterns are platform-stable.
const globToRegExp = (pattern: string): RegExp => {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i] as string;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**` → any number of path segments (incl. zero). Swallow a trailing
        // slash so `**/x` also matches `x` at the root.
        re += "(?:.*/)?";
        i += 2;
        if (pattern[i] === "/") i += 1;
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if ("\\^$+.()|{}[]".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp("^" + re + "$");
};

const toPosix = (p: string): string => p.split(sep).join("/");

// Recursively enumerate regular files under `root`, capped. Symlinks are NOT
// followed (withFileTypes + isDirectory() is false for symlinked dirs), and
// every returned path is later re-gated before being opened, so escaping the
// boundary via a symlink is doubly prevented.
const walkFiles = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < MAX_FILES_WALKED) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip, don't throw
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        out.push(full);
        if (out.length >= MAX_FILES_WALKED) break;
      }
    }
  }
  return out;
};

const readFileSlice = async (
  absPath: string,
  offset: number | undefined,
  limit: number | undefined,
): Promise<string> => {
  const content = await fs.readFile(absPath, "utf8");
  if (offset === undefined && limit === undefined) return content;
  const lines = content.split("\n");
  const start = offset !== undefined && offset > 0 ? offset - 1 : 0;
  const end = limit !== undefined && limit > 0 ? start + limit : lines.length;
  return lines.slice(start, end).join("\n");
};

const runRead = async (input: Record<string, unknown>, sec: FsSecCtx): Promise<string> => {
  const filePath = asString(input["file_path"]);
  if (filePath === undefined || filePath === "") return "[error] file_path is required";
  const deny = gateDeny(sec, "Read", { file_path: filePath });
  if (deny !== undefined) return deny;
  const abs = isAbsolute(filePath) ? filePath : resolve(sec.agentCwd, filePath);
  try {
    return cap(await readFileSlice(abs, asNumber(input["offset"]), asNumber(input["limit"])));
  } catch (err) {
    return "[error] " + (err instanceof Error ? err.message : String(err));
  }
};

// Resolve and gate the search root shared by Glob and Grep. Returns either the
// absolute root path (allowed) or a deny/error string.
const resolveSearchRoot = (
  pathInput: string | undefined,
  sec: FsSecCtx,
): { ok: true; root: string } | { ok: false; msg: string } => {
  const root = pathInput !== undefined && pathInput !== "" ? pathInput : sec.agentCwd;
  // Gate the root via the Read fence (the gate reads `file_path`/`path`).
  const deny = gateDeny(sec, "Read", {
    file_path: isAbsolute(root) ? root : resolve(sec.agentCwd, root),
  });
  if (deny !== undefined) return { ok: false, msg: deny };
  return { ok: true, root: isAbsolute(root) ? root : resolve(sec.agentCwd, root) };
};

const runGlob = async (input: Record<string, unknown>, sec: FsSecCtx): Promise<string> => {
  const pattern = asString(input["pattern"]);
  if (pattern === undefined || pattern === "") return "[error] pattern is required";
  const rooted = resolveSearchRoot(asString(input["path"]), sec);
  if (!rooted.ok) return rooted.msg;
  const re = globToRegExp(pattern);
  try {
    const files = await walkFiles(rooted.root);
    const matches: string[] = [];
    for (const file of files) {
      const rel = toPosix(relative(rooted.root, file));
      if (!re.test(rel)) continue;
      // Per-file boundary re-check (pure, no audit) — blocklist + zone.
      if (!fileWithinBoundary(file, sec)) continue;
      matches.push(file);
      if (matches.length >= MAX_GLOB_RESULTS) break;
    }
    return matches.length === 0 ? "[no matches]" : cap(matches.join("\n"));
  } catch (err) {
    return "[error] " + (err instanceof Error ? err.message : String(err));
  }
};

const runGrep = async (input: Record<string, unknown>, sec: FsSecCtx): Promise<string> => {
  const pattern = asString(input["pattern"]);
  if (pattern === undefined || pattern === "") return "[error] pattern is required";
  const rooted = resolveSearchRoot(asString(input["path"]), sec);
  if (!rooted.ok) return rooted.msg;

  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    return "[error] invalid regex: " + (err instanceof Error ? err.message : String(err));
  }
  const globFilter = asString(input["glob"]);
  const globRe = globFilter !== undefined && globFilter !== "" ? globToRegExp(globFilter) : null;

  try {
    const files = await walkFiles(rooted.root);
    const lines: string[] = [];
    for (const file of files) {
      const rel = toPosix(relative(rooted.root, file));
      if (globRe !== null && !globRe.test(rel)) continue;
      // Per-file boundary re-check (pure, no audit) before opening — blocklist + zone.
      if (!fileWithinBoundary(file, sec)) continue;
      let content: string;
      try {
        content = await fs.readFile(file, "utf8");
      } catch {
        continue; // unreadable/binary — skip
      }
      const fileLines = content.split("\n");
      for (let n = 0; n < fileLines.length; n++) {
        const text = fileLines[n] as string;
        if (re.test(text)) {
          lines.push(`${file}:${String(n + 1)}:${text}`);
          if (lines.length >= MAX_GREP_RESULTS) break;
        }
      }
      if (lines.length >= MAX_GREP_RESULTS) break;
    }
    return lines.length === 0 ? "[no matches]" : cap(lines.join("\n"));
  } catch (err) {
    return "[error] " + (err instanceof Error ? err.message : String(err));
  }
};

export const runFsTool = async (name: string, input: unknown, sec: FsSecCtx): Promise<string> => {
  const ti = asObject(input);
  switch (name) {
    case "Read":
      return runRead(ti, sec);
    case "Glob":
      return runGlob(ti, sec);
    case "Grep":
      return runGrep(ti, sec);
    default:
      return "[error] not an fs tool: " + name;
  }
};
