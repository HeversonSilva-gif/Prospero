const OAUTH_REGEX = /^sk-ant-oat[A-Za-z0-9_-]{20,}$/;

export const isWellFormedToken = (raw: string): boolean => OAUTH_REGEX.test(raw.trim());
