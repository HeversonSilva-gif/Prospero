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

// v0.2.14 token audit (Onda A #4): the AUTHORITY side of the approval+verification
// loop — the DECIDER/JUDGE tools. Unlike the communication meta tools
// (message_agent/notify_user/report_to_user/request_*), these only do something
// for an agent that actually OWNS pending requests or criteria to judge: a manager
// (delegation) or, for criterion_judge, an issues-capable verifier. A plain worker
// is never an approver, so decide_request/decide_batch are inert for it and
// criterion_judge is covered by the issues capability when present. We therefore
// stop force-advertising these three to every agent — a pure cache-size trim with
// ZERO capability loss (the supervised gate still auto-approves them, and a worker
// that could legitimately reach one gets it via its own capability set, below).
//
// IMPORTANT: `decide_batch` has NO capability home (it's in CAPABILITY_CATALOG
// for no role), so it reaches the CEO ONLY through this gate. It must stay visible
// whenever the agent has `delegation` — hence the delegation check, not removal.
const AUTHORITY_META_TOOLS = new Set(["decide_request", "decide_batch", "criterion_judge"]);

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
  const hasDelegation = agent.capabilities.includes("delegation");
  const visible = new Set<string>();
  for (const name of allToolNames) {
    // The agent's own capability set always wins — an issues worker keeps
    // criterion_judge here, a delegation manager keeps decide_request here.
    if (allowed.has(`${DASHBOARD_PREFIX}${name}`) || isReadOnlyTool(name)) {
      visible.add(name);
      continue;
    }
    if (isMetaOrchestrationTool(name)) {
      // Authority meta tools are force-advertised only to managers (delegation).
      // Everyone else relies on their capability set (handled above) to home them.
      if (AUTHORITY_META_TOOLS.has(name) && !hasDelegation) continue;
      visible.add(name);
    }
  }
  return visible;
};
