export const verifyMcpToken = (
  expected: string | undefined,
  provided: string | undefined,
): void => {
  if (expected === undefined || expected === "") {
    throw new Error("MCP_TOKEN env not set on server");
  }
  if (provided !== expected) {
    throw new Error("Invalid MCP token");
  }
};
