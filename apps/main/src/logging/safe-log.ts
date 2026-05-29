import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { homedir, platform } from "node:os";
import { redactString } from "../auth/token-redact.js";

const DEFAULT_MAX_BYTES = 5_000_000;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Make a log line safe to write to disk / share for support:
 *  - mask credential-shaped substrings (via redactString)
 *  - replace the user's home directory with `~` so absolute paths no longer
 *    leak the OS username (C:\Users\hever -> ~).
 * Pure; never throws.
 */
export const redactSensitive = (line: string, opts?: { homeDir?: string }): string => {
  let out = redactString(line);

  const home = opts?.homeDir ?? homedir();
  if (home !== "") {
    // Match the home dir with either separator and (on Windows) case-insensitively.
    // Build a pattern that tolerates `\` or `/` between path segments.
    const segments = home.split(/[\\/]/).map(escapeRegex);
    const pattern = segments.join("[\\\\/]");
    const flags = platform() === "win32" ? "gi" : "g";
    out = out.replace(new RegExp(pattern, flags), "~");
  }

  return out;
};

/**
 * Append `line + "\n"` to `filePath`. If the file already exceeds `maxBytes`,
 * rotate it first: rename filePath -> filePath + ".1" (overwriting any prior
 * .1) and start fresh. Best-effort — never throws (logging must not crash the
 * app).
 */
export const rotatingAppend = (
  filePath: string,
  line: string,
  opts?: { maxBytes?: number },
): void => {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (existsSync(filePath)) {
      let size = 0;
      try {
        size = statSync(filePath).size;
      } catch {
        size = 0;
      }
      if (size >= maxBytes) {
        try {
          renameSync(filePath, filePath + ".1");
        } catch {
          /* best effort — if rotation fails we still append */
        }
      }
    }

    appendFileSync(filePath, line + "\n", "utf8");
  } catch {
    /* ignore log errors */
  }
};

/** rotatingAppend with the line run through redactSensitive first. */
export const safeAppend = (
  filePath: string,
  line: string,
  opts?: { maxBytes?: number; homeDir?: string },
): void => {
  rotatingAppend(filePath, redactSensitive(line, opts), opts);
};
