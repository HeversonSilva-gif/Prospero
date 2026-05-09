const OAUTH_REGEX = /sk-ant-oat[A-Za-z0-9_-]{20,}/g;
const API_REGEX = /sk-ant-api03-[A-Za-z0-9_-]{50,}/g;

export const redactToken = (raw: string): string => {
  if (raw === "") return "";
  if (raw.length <= 12) return raw.slice(0, 2) + "...[REDACTED]";
  return raw.slice(0, 11) + "...[REDACTED]";
};

export const redactString = (s: string): string =>
  s.replace(OAUTH_REGEX, "[REDACTED]").replace(API_REGEX, "[REDACTED]");
