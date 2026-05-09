import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isWellFormedToken } from "./token-validate.js";

/**
 * Reads `<home>/.claude/.credentials.json` and tries to extract the OAuth access token.
 * Returns the token string if a well-formed value is present, otherwise null.
 *
 * @param home override of the user's home directory; defaults to os.homedir().
 *             Tests pass a temp directory here.
 */
export const detectClaudeCliToken = (home: string = homedir()): string | null => {
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
  if (typeof token !== "string") return null;
  return isWellFormedToken(token) ? token : null;
};
