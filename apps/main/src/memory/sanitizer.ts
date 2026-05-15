import { matchesBlockedBash, matchesBlockedPath } from "../security/blocklist.js";

// Prompt-injection patterns that must never enter a memory or skill body.
// Memory and skill L0 are injected verbatim into the system prompt, so an
// injected "ignore previous instructions" would hijack every future session.
const INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|context)\b/i,
  /\bdisregard\s+(all\s+)?(previous|prior|above|your)\b/i,
  /\b(you\s+are\s+now|from\s+now\s+on,?\s+you)\b/i,
  /\bsystem\s*(prompt|message)\s*[:=]/i,
  /\b(reveal|print|repeat|output)\s+(your|the)\s+(system\s+prompt|instructions)\b/i,
  /<\/?(system|instructions?)>/i,
  /\[\/?(INST|SYS)\]/i,
];

export type SanitizeResult = { ok: true } | { ok: false; reason: string };

// Validates a memory or skill body before it is persisted. Applied in BOTH
// write paths — manual MCP tools (PR-C) and the auto-derivation pipeline
// (PR-D). The derivation path is LLM-generated and therefore equally untrusted.
export const sanitizeMemoryBody = (body: string): SanitizeResult => {
  for (const re of INJECTION_PATTERNS) {
    if (re.test(body)) return { ok: false, reason: `injection pattern: ${re.source}` };
  }
  if (matchesBlockedBash(body)) return { ok: false, reason: "blocked shell pattern" };
  if (matchesBlockedPath(body)) return { ok: false, reason: "blocked sensitive path" };
  return { ok: true };
};
