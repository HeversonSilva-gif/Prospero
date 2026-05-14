import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isWellFormedToken } from "./token-validate.js";

export type DetectedToken = { token: string; expiresAt: number | null };

/**
 * Reads `<home>/.claude/.credentials.json` and extracts the OAuth access token
 * + optional `expiresAt`. Returns null if no well-formed token found.
 *
 * @param home override of the user's home directory; defaults to os.homedir().
 *             Tests pass a temp directory here.
 */
export const detectClaudeCliToken = (home: string = homedir()): DetectedToken | null => {
  const path = join(home, ".claude", ".credentials.json");
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const candidate = (parsed as Record<string, unknown>)["claudeAiOauth"];
  if (candidate === null || typeof candidate !== "object") return null;
  const token = (candidate as Record<string, unknown>)["accessToken"];
  if (typeof token !== "string" || !isWellFormedToken(token)) return null;
  const rawExpires = (candidate as Record<string, unknown>)["expiresAt"];
  const expiresAt =
    typeof rawExpires === "number" && Number.isFinite(rawExpires) ? rawExpires : null;
  return { token, expiresAt };
};
