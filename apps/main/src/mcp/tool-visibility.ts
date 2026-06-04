import { resolveCapabilityTools, applyRunPolicy } from "@prospero/shared";
import { isReadOnlyTool } from "../trust/read-only-tools.js";
import { isMetaOrchestrationTool } from "../security/meta-tools.js";

// v0.2.10 token audit (prompt C1): the MCP server used to advertise ALL ~60 tool schemas
// to every agent regardless of role, so a fs-read/issues worker paid to cache the CEO's
// genesis/org/goal/ISA/connector schemas on every turn. This computes the set of dashboard
// tool NAMES (bare — no `mcp__dashboard__` prefix) an agent can actually REACH, so the
// server registers only those.
//
// SAFETY: the returned set is a SUPERSET of everything reachable, so it can never hide a
// tool the agent could legitimately invoke:
//   - its --allowedTools capability set (applyRunPolicy(resolveCapabilityTools(...)) — the
//     SAME resolution build-args uses at spawn, incl. the forced chat+memory capabilities),
//   - every read-only tool (the trust gate auto-approves these for ANY agent), and
//   - every meta-orchestration tool (the supervised gate auto-approves these — this is why
//     e.g. `decide_batch`, which is in NO capability, stays visible to the CEO).
// `--allowedTools` remains the real invocation boundary; this is purely a cache-size
// optimization. The caller (server.ts) additionally falls OPEN — registers everything — if
// the agent row can't be read, so a resolution failure never strands an agent without tools.
const DASHBOARD_PREFIX = "mcp__dashboard__";

export const visibleToolNames = (
  allToolNames: string[],
  agent: { capabilities: string[]; canHire: boolean; canAssign: boolean },
): Set<string> => {
  const allowed = new Set(
    applyRunPolicy(resolveCapabilityTools(agent.capabilities), {
      canHire: agent.canHire,
      canAssign: agent.canAssign,
    }),
  );
  const visible = new Set<string>();
  for (const name of allToolNames) {
    if (
      allowed.has(`${DASHBOARD_PREFIX}${name}`) ||
      isReadOnlyTool(name) ||
      isMetaOrchestrationTool(name)
    ) {
      visible.add(name);
    }
  }
  return visible;
};
