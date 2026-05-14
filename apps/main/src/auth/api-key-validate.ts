// Anthropic API keys are issued as sk-ant-api<NN>-<base64url-ish>. The exact
// length varies; we accept a generous range and validate only the prefix +
// charset to block command-injection without rejecting future formats.
const API_KEY_REGEX = /^sk-ant-api[0-9]{1,3}-[A-Za-z0-9_-]{40,}$/;

export const isWellFormedApiKey = (raw: string): boolean => API_KEY_REGEX.test(raw.trim());
