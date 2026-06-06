import { describe, it, expect } from "vitest";
import { visibleToolNames } from "./tool-visibility.js";
import { toolDefinitions } from "./tools.js";
import { goalsToolDefinitions } from "./tools-goals.js";
import { orgToolDefinitions } from "./tools-org.js";
import { genesisToolDefinitions } from "./tools-genesis.js";
import { issuesToolDefinitions } from "./tools-issues.js";
import { memoryToolDefinitions } from "./tools-memory.js";
import { isaToolDefinitions } from "./tools-isa.js";
import { projectContextToolDefinitions } from "./tools-project-context.js";

// The exact union the MCP server registers (server.ts).
const allNames = [
  ...toolDefinitions,
  ...goalsToolDefinitions,
  ...orgToolDefinitions,
  ...genesisToolDefinitions,
  ...issuesToolDefinitions,
  ...memoryToolDefinitions,
  ...isaToolDefinitions,
  ...projectContextToolDefinitions,
].map((d) => d.name);

// The live CEO seed (agents/seed.ts) and an ordinary engineer worker.
const CEO_CAPS = ["delegation", "issues", "inbox", "chat", "fs-read", "web", "finance"];
const ENGINEER_CAPS = ["shell", "fs-write"];

describe("visibleToolNames", () => {
  it("CEO sees the planning + connector tools its capabilities grant", () => {
    const v = visibleToolNames(allNames, {
      capabilities: CEO_CAPS,
      canHire: true,
      canAssign: true,
    });
    // delegation → org/business/goal plans + hire/fire
    expect(v.has("submit_org_plan")).toBe(true);
    expect(v.has("submit_business_plan")).toBe(true);
    expect(v.has("submit_goal_plan")).toBe(true);
    expect(v.has("hire_agent")).toBe(true);
    expect(v.has("fire_agent")).toBe(true);
    // finance capability
    expect(v.has("finance_read")).toBe(true);
  });

  it("engineer does NOT see CEO-only planning/connector/deploy/email-send tools", () => {
    const v = visibleToolNames(allNames, {
      capabilities: ENGINEER_CAPS,
      canHire: true,
      canAssign: true,
    });
    for (const hidden of [
      "submit_business_plan",
      "submit_org_plan",
      "submit_goal_plan",
      "hire_agent_for_plan",
      "finalize_goal_execution",
      "update_goal_status",
      "record_subgoal",
      "post_to_x",
      "send_email",
      "deploy_app",
      "setup_monetization",
    ]) {
      expect(v.has(hidden), `${hidden} should be hidden from an engineer`).toBe(false);
    }
  });

  it("every agent keeps forced chat + memory tools (resolveCapabilityTools force-adds them)", () => {
    const v = visibleToolNames(allNames, {
      capabilities: ENGINEER_CAPS,
      canHire: true,
      canAssign: true,
    });
    for (const kept of [
      "request_permission",
      "request_decision",
      "skill_read",
      "memory_read",
      "isa_read",
      "telos_read",
      "project_context_read",
    ]) {
      expect(v.has(kept), `${kept} should stay visible`).toBe(true);
    }
  });

  it("keeps read-only and communication meta tools visible to a worker (reachable via the gate)", () => {
    const v = visibleToolNames(allNames, {
      capabilities: ENGINEER_CAPS,
      canHire: true,
      canAssign: true,
    });
    // read-only (MCP_ALLOWLIST / list_*)
    expect(v.has("list_issues")).toBe(true);
    expect(v.has("check_status")).toBe(true);
    // communication meta stays visible (auto-approved in supervised)
    expect(v.has("create_issue")).toBe(true);
    expect(v.has("message_agent")).toBe(true);
    // authority meta (decide_*/criterion_judge) is now manager-scoped — see below.
  });

  it("hides authority decision tools from a non-manager worker (it is never an approver/judge)", () => {
    const v = visibleToolNames(allNames, {
      capabilities: ENGINEER_CAPS, // no delegation, no issues
      canHire: true,
      canAssign: true,
    });
    for (const authority of ["decide_request", "decide_batch", "criterion_judge"]) {
      expect(v.has(authority), `${authority} should be hidden from a non-manager`).toBe(false);
    }
  });

  it("keeps authority decision tools visible to a delegation manager (decide_batch has no capability home)", () => {
    const v = visibleToolNames(allNames, {
      capabilities: ["delegation", "chat"],
      canHire: true,
      canAssign: true,
    });
    expect(v.has("decide_request")).toBe(true);
    expect(v.has("decide_batch")).toBe(true);
    expect(v.has("criterion_judge")).toBe(true);
  });

  it("an issues worker still sees criterion_judge via its capability, but not the decide tools", () => {
    const v = visibleToolNames(allNames, {
      capabilities: ["issues", "chat"],
      canHire: true,
      canAssign: true,
    });
    expect(v.has("criterion_judge")).toBe(true); // homed by the issues capability
    expect(v.has("decide_batch")).toBe(false); // still manager-only
    expect(v.has("decide_request")).toBe(false);
  });

  it("canHire=false hides hire_agent/fire_agent even for a delegation agent (mirrors --allowedTools)", () => {
    const v = visibleToolNames(allNames, {
      capabilities: ["delegation", "chat"],
      canHire: false,
      canAssign: true,
    });
    expect(v.has("hire_agent")).toBe(false);
    expect(v.has("fire_agent")).toBe(false);
    // but other delegation tools remain
    expect(v.has("submit_org_plan")).toBe(true);
  });

  it("filtering actually reduces the surface for a worker (token win) and is a subset of all", () => {
    const v = visibleToolNames(allNames, {
      capabilities: ENGINEER_CAPS,
      canHire: true,
      canAssign: true,
    });
    expect(v.size).toBeLessThan(allNames.length);
    for (const name of v) expect(allNames).toContain(name);
  });
});
