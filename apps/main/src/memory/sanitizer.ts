import { matchesBlockedBash, matchesBlockedPath } from "../security/blocklist.js";
import { detectInjection } from "../security/injection-detector.js";

// Prompt-injection patterns that must never enter a memory or skill body.
// Memory and skill L0 are injected verbatim into the system prompt, so an
// injected "ignore previous instructions" would hijack every future session.
// English patterns are the fast-path; PT patterns cover Portuguese variants
// that bypass the English regex but carry the same attack semantics.
const INJECTION_PATTERNS: RegExp[] = [
  // English
  /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|context)\b/i,
  /\bdisregard\s+(all\s+)?(previous|prior|above|your)\b/i,
  /\b(you\s+are\s+now|from\s+now\s+on,?\s+you)\b/i,
  /\bsystem\s*(prompt|message)\s*[:=]/i,
  /\b(reveal|print|repeat|output)\s+(your|the)\s+(system\s+prompt|instructions)\b/i,
  /<\/?(system|instructions?)>/i,
  /\[\/?(INST|SYS)\]/i,
  // Portuguese — "ignore as instruções anteriores", "revele o prompt do sistema", etc.
  /\b(ignore|desconsidere|esqueça|ignore)\s+(as\s+)?(instruções|instrucoes|ordens|regras)\s+(anteriores|acima|anteriores)\b/i,
  /\b(revele?|mostre?|imprima?|repita?|exiba?)\s+.{0,30}(prompt|instruções|instrucoes)\s+(do\s+sistema|do sistema|de sistema)\b/i,
  /\b(a\s+partir\s+de\s+agora|de\s+agora\s+em\s+diante)[,\s]+você\s+[eé]\b/i,
];

// Credential/secret patterns that must never be stored in memory bodies.
// A stored secret would be injected verbatim into every L0 system prompt,
// leaking credentials to every agent session that loads those memories.
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[a-z0-9-]{8,}/i, // Anthropic key
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, // PEM private key
  /\b(?:api[_-]?key|secret|token|password|passwd|senha)\b\s*[:=]\s*\S{6,}/i, // generic k=v secret (incl PT "senha")
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // GitHub token
];

export type SanitizeResult = { ok: true } | { ok: false; reason: string };

// Validates a memory or skill body before it is persisted. Applied in BOTH
// write paths — manual MCP tools (PR-C) and the auto-derivation pipeline
// (PR-D). The derivation path is LLM-generated and therefore equally untrusted.
export const sanitizeMemoryBody = (body: string): SanitizeResult => {
  // Fast-path: English injection patterns (kept as first gate for performance).
  for (const re of INJECTION_PATTERNS) {
    if (re.test(body)) return { ok: false, reason: `injection pattern: ${re.source}` };
  }
  if (matchesBlockedBash(body)) return { ok: false, reason: "blocked shell pattern" };
  if (matchesBlockedPath(body)) return { ok: false, reason: "blocked sensitive path" };

  // Deep injection check: handles PT, leet, homoglyphs, zero-width obfuscation.
  // Memory bodies are injected verbatim into L0, so treat both "flag" and "block"
  // as reject (stricter than the email path which only blocks on "block").
  const v = detectInjection(body);
  if (v.verdict !== "allow") {
    return { ok: false, reason: `injection: ${v.reasons.join(",")}` };
  }

  // Secret/credential detection: stored secrets would leak into every session.
  for (const re of SECRET_PATTERNS) {
    if (re.test(body)) return { ok: false, reason: "secret-like content" };
  }

  return { ok: true };
};
