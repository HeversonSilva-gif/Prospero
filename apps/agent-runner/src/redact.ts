type SecretPattern = { re: RegExp; replacement: string };

// Token shapes worth masking before a stderr line leaves the container.
const SECRET_PATTERNS: SecretPattern[] = [
  { re: /sk-ant-[A-Za-z0-9_-]{8,}/g, replacement: "[redacted]" },
  { re: /\bgh[opsu]_[A-Za-z0-9]{16,}\b/g, replacement: "[redacted]" },
  { re: /Bearer\s+[A-Za-z0-9._-]{12,}/gi, replacement: "Bearer [redacted]" },
];

/** Masks token-shaped substrings so forwarded stderr never leaks a credential. */
export const redactSecrets = (line: string): string => {
  let out = line;
  for (const { re, replacement } of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
};
