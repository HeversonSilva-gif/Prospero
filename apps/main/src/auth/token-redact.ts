// Token shapes worth masking before a log line is written to disk or shared.
// Mirrors the broader regex set in apps/agent-runner/src/redact.ts so the main
// process redacts the same credential shapes the runner does.
type SecretPattern = { re: RegExp; replacement: string };

const SECRET_PATTERNS: SecretPattern[] = [
  // Any Anthropic key shape (oauth sk-ant-oat..., api sk-ant-api03-..., etc.).
  { re: /sk-ant-[A-Za-z0-9_-]{8,}/g, replacement: "[REDACTED]" },
  // GitHub tokens (ghp_, gho_, ghs_, ghu_).
  { re: /\bgh[opsu]_[A-Za-z0-9]{16,}\b/g, replacement: "[REDACTED]" },
  // Stripe keys — restricted (rk_) and secret (sk_), live or test. Audit
  // 2026-06-03 Conectores M1: the connector secret was outside the redaction set.
  { re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replacement: "[REDACTED]" },
  // Authorization: Bearer <token>.
  { re: /Bearer\s+[A-Za-z0-9._-]{12,}/gi, replacement: "Bearer [REDACTED]" },
  // Env-var assignments that carry a credential value.
  {
    re: /\b(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)=\S+/g,
    replacement: "$1=[REDACTED]",
  },
];

export const redactToken = (raw: string): string => {
  if (raw === "") return "";
  if (raw.length <= 12) return raw.slice(0, 2) + "...[REDACTED]";
  return raw.slice(0, 11) + "...[REDACTED]";
};

export const redactString = (s: string): string => {
  let out = s;
  for (const { re, replacement } of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
};
