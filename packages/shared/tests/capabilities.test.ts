import { describe, it, expect } from "vitest";
import {
  KNOWN_CLAUDE_TOOLS,
  CAPABILITY_CATALOG,
  ensureChatCapability,
  capabilitiesToTools,
  resolveCapabilityTools,
  applyRunPolicy,
} from "../src/capabilities.js";

describe("capability catalog", () => {
  it("includes the 11 canonical capability ids", () => {
    expect(Object.keys(CAPABILITY_CATALOG).sort()).toEqual([
      "chat",
      "connectors",
      "delegation",
      "deploy",
      "fs-read",
      "fs-write",
      "inbox",
      "issues",
      "memory",
      "shell",
      "web",
    ]);
  });

  it("includes the connectors capability with the X + Stripe tools", () => {
    expect(CAPABILITY_CATALOG.connectors.tools).toEqual([
      "mcp__dashboard__post_to_x",
      "mcp__dashboard__reply_on_x",
      "mcp__dashboard__x_insights_read",
      "mcp__dashboard__setup_monetization",
      "mcp__dashboard__create_payment_link",
      "mcp__dashboard__stripe_sales_read",
    ]);
  });

  it("includes the deploy capability with the Cloudflare deploy tools", () => {
    expect(CAPABILITY_CATALOG.deploy.tools).toEqual([
      "mcp__dashboard__deploy_app",
      "mcp__dashboard__deployment_status",
    ]);
  });

  it("includes the memory capability with the M11 tools + universal TELOS/ISA reads + project context", () => {
    expect(CAPABILITY_CATALOG.memory.tools).toHaveLength(14);
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__skill_promote");
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__skill_search");
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__memory_add");
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__session_search");
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__isa_read");
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__telos_read");
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__project_context_read");
    expect(CAPABILITY_CATALOG.memory.tools).toContain("mcp__dashboard__project_context_note");
  });

  it("every built-in tool in KNOWN_CLAUDE_TOOLS is mapped by at least one capability", () => {
    const mapped = new Set<string>();
    for (const capability of Object.values(CAPABILITY_CATALOG)) {
      for (const t of capability.tools) mapped.add(t);
    }
    for (const tool of KNOWN_CLAUDE_TOOLS) {
      expect(mapped.has(tool), `tool "${tool}" has no capability mapping`).toBe(true);
    }
  });
});

describe("ensureChatCapability", () => {
  it("adds 'chat' when missing", () => {
    expect(ensureChatCapability(["shell"]).sort()).toEqual(["chat", "shell"]);
  });

  it("does not duplicate 'chat' when present", () => {
    expect(ensureChatCapability(["chat", "shell"]).sort()).toEqual(["chat", "shell"]);
  });

  it("preserves order otherwise", () => {
    expect(ensureChatCapability(["shell", "fs-read"])).toEqual(["shell", "fs-read", "chat"]);
  });
});

describe("capabilitiesToTools", () => {
  it("returns Bash for shell capability", () => {
    expect(capabilitiesToTools(["shell"])).toContain("Bash");
  });

  it("returns Read, Glob, Grep for fs-read", () => {
    const tools = capabilitiesToTools(["fs-read"]);
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
  });

  it("returns Edit, Write, NotebookEdit for fs-write", () => {
    const tools = capabilitiesToTools(["fs-write"]);
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("NotebookEdit");
  });

  it("returns WebFetch, WebSearch for web", () => {
    const tools = capabilitiesToTools(["web"]);
    expect(tools).toContain("WebFetch");
    expect(tools).toContain("WebSearch");
  });

  it("returns mcp__dashboard__hire_agent etc for delegation", () => {
    const tools = capabilitiesToTools(["delegation"]);
    expect(tools).toContain("mcp__dashboard__hire_agent");
    expect(tools).toContain("mcp__dashboard__message_agent");
    expect(tools).toContain("mcp__dashboard__list_agents");
  });

  it("returns mcp__dashboard__create_issue etc for issues", () => {
    const tools = capabilitiesToTools(["issues"]);
    expect(tools).toContain("mcp__dashboard__create_issue");
    expect(tools).toContain("mcp__dashboard__update_issue");
  });

  it("returns request_permission + request_decision for chat capability", () => {
    expect(capabilitiesToTools(["chat"])).toEqual([
      "mcp__dashboard__request_permission",
      "mcp__dashboard__request_decision",
    ]);
  });

  it("returns the CEO approval tools for delegation", () => {
    const tools = capabilitiesToTools(["delegation"]);
    expect(tools).toContain("mcp__dashboard__decide_request");
    expect(tools).toContain("mcp__dashboard__list_pending_requests");
  });

  it("ignores unknown capability ids (does not throw)", () => {
    const tools = capabilitiesToTools(["shell", "totally-fake-capability"]);
    expect(tools).toContain("Bash");
  });

  it("deduplicates when two capabilities map to overlapping tools (none today, but pattern-test)", () => {
    const tools = capabilitiesToTools(["shell", "shell"]);
    const bashCount = tools.filter((t) => t === "Bash").length;
    expect(bashCount).toBe(1);
  });
});

describe("resolveCapabilityTools (full resolver with chat safety-net)", () => {
  it("auto-injects chat capability if missing", () => {
    const tools = resolveCapabilityTools(["shell"]);
    expect(tools).toContain("Bash");
    expect(tools).toContain("mcp__dashboard__request_permission");
  });

  it("empty capability list still gets request_permission via chat safety-net", () => {
    expect(resolveCapabilityTools([])).toContain("mcp__dashboard__request_permission");
  });

  it("every agent can ask the manager (request_decision is universal via chat)", () => {
    expect(resolveCapabilityTools([])).toContain("mcp__dashboard__request_decision");
    expect(resolveCapabilityTools(["fs-write"])).toContain("mcp__dashboard__request_decision");
  });
});

describe("resolveCapabilityTools force-adds memory", () => {
  it("includes memory tools even when not requested", () => {
    const tools = resolveCapabilityTools(["shell"]);
    expect(tools).toContain("mcp__dashboard__skill_search");
    expect(tools).toContain("mcp__dashboard__memory_add");
  });
});

const ALL = [...CAPABILITY_CATALOG.delegation.tools, ...CAPABILITY_CATALOG.issues.tools];

describe("applyRunPolicy", () => {
  it("returns the list unchanged when both flags are true", () => {
    expect(applyRunPolicy(ALL, { canHire: true, canAssign: true })).toEqual(ALL);
  });

  it("removes hire_agent and fire_agent when canHire is false", () => {
    const out = applyRunPolicy(ALL, { canHire: false, canAssign: true });
    expect(out).not.toContain("mcp__dashboard__hire_agent");
    expect(out).not.toContain("mcp__dashboard__fire_agent");
    expect(out).toContain("mcp__dashboard__message_agent");
    expect(out).toContain("mcp__dashboard__list_agents");
    expect(out).toContain("mcp__dashboard__assign_issue");
  });

  it("removes assign_issue when canAssign is false", () => {
    const out = applyRunPolicy(ALL, { canHire: true, canAssign: false });
    expect(out).not.toContain("mcp__dashboard__assign_issue");
    expect(out).toContain("mcp__dashboard__create_issue");
    expect(out).toContain("mcp__dashboard__hire_agent");
  });
});
