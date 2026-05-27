// Classifier for approvals that MUST NOT be coalesced. A destructive
// approval, when it arrives, collapses any pending coalescing window for
// its CEO — the CEO wakes immediately. Spec rationale: the asymmetric
// risk of a wrong decision on a destructive call outweighs the token
// savings of batching.

const DESTRUCTIVE_BUILTIN_TOOLS = new Set(["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]);

const stripMcpPrefix = (name: string): string => {
  if (!name.startsWith("mcp__")) return name;
  const parts = name.split("__");
  return parts.length >= 3 ? parts.slice(2).join("__") : name;
};

const isDestructiveTool = (toolName: string): boolean => {
  if (toolName.length === 0) return false;
  return DESTRUCTIVE_BUILTIN_TOOLS.has(stripMcpPrefix(toolName));
};

export type DestructiveCheck = {
  kind: "tool_call" | "manager_request";
  payloadJson: string;
};

export const isDestructiveApproval = (a: DestructiveCheck): boolean => {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(a.payloadJson) as Record<string, unknown>;
  } catch {
    // Malformed payload: be conservative — coalesce. A bad payload won't
    // get the CEO into trouble because the underlying gate/decide path
    // will reject it anyway.
    return false;
  }

  if (a.kind === "tool_call") {
    const toolName =
      typeof payload["tool_name"] === "string" ? (payload["tool_name"]) : "";
    return isDestructiveTool(toolName);
  }

  // manager_request
  const topic = typeof payload["topic"] === "string" ? (payload["topic"]) : "";
  if (topic === "fire") return true;
  if (topic === "budget" && payload["over_limit"] === true) return true;
  return false;
};
