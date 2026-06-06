import { describe, it, expect } from "vitest";
import { buildClaudeArgs } from "./build-args.js";
import type { Agent } from "@prospero/shared";

const ceo = (): Agent =>
  ({
    id: "ceo1",
    companyId: "c1",
    name: "CEO",
    role: "ceo",
    templateId: "ceo",
    systemPrompt: "You are the CEO.",
    capabilities: [],
    canHire: true,
    canAssign: true,
    model: "claude-sonnet-4-6",
    claudeSessionId: null,
  }) as unknown as Agent;

const systemPromptOf = (args: string[]): string => {
  const i = args.indexOf("--system-prompt");
  return i === -1 ? "" : (args[i + 1] ?? "");
};

const allowedToolsOf = (args: string[]): string[] => {
  const i = args.indexOf("--allowedTools");
  return i === -1 ? [] : (args[i + 1] ?? "").split(",").filter((t) => t.length > 0);
};

// Extracts the exact tool tokens advertised in the prompt's "visible tools"
// line, so substring false-positives (e.g. hire_agent vs hire_agent_for_plan)
// don't pollute assertions.
const promptToolList = (prompt: string): string[] => {
  const m = prompt.match(/visible Claude tools to: (.+)\./);
  return m === null ? [] : (m[1] ?? "").split(", ").filter((t) => t.length > 0);
};

describe("buildClaudeArgs — CEO capability boundary (audit 2026-06-03)", () => {
  it("threads opts.capabilityBoundary into the CEO genesis prompt (not a hardcoded ['x'])", () => {
    const args = buildClaudeArgs(ceo(), null, {
      capabilityBoundary: "MARKER_BOUNDARY_TEXT_123",
    });
    expect(systemPromptOf(args)).toContain("MARKER_BOUNDARY_TEXT_123");
  });

  it("falls back to a default boundary when none is provided", () => {
    const args = buildClaudeArgs(ceo(), null, {});
    // The default boundary prose still renders (back-compat) — it just isn't
    // grounded in the company's real connectors.
    expect(systemPromptOf(args)).toContain("Marketing channels you can operate now");
  });

  it("does not inject a capability boundary for a non-CEO agent", () => {
    const worker = { ...ceo(), role: "engineer", templateId: "role-engineer" } as Agent;
    const args = buildClaudeArgs(worker, null, {
      capabilityBoundary: "MARKER_BOUNDARY_TEXT_123",
    });
    expect(systemPromptOf(args)).not.toContain("MARKER_BOUNDARY_TEXT_123");
  });
});

// Audit 2026-06-03 Inteligência & Contexto I9: the prompt's "visible tools"
// line must mirror the run-policy-filtered --allowedTools, not the raw
// capability resolution — otherwise the prompt promises tools the CLI blocks.
describe("buildClaudeArgs — prompt tool list matches --allowedTools (audit 2026-06-03 I9)", () => {
  const delegator = (over: Partial<Agent>): Agent => ({
    ...ceo(),
    capabilities: ["delegation", "issues"],
    ...over,
  });

  it("omits hire_agent/assign_issue from the prompt when canHire=false & canAssign=false", () => {
    const agent = delegator({ canHire: false, canAssign: false });
    const tools = promptToolList(systemPromptOf(buildClaudeArgs(agent, null, {})));
    expect(tools).not.toContain("mcp__dashboard__hire_agent");
    expect(tools).not.toContain("mcp__dashboard__fire_agent");
    expect(tools).not.toContain("mcp__dashboard__assign_issue");
  });

  it("includes hire_agent/assign_issue in the prompt when canHire=true & canAssign=true", () => {
    const agent = delegator({ canHire: true, canAssign: true });
    const tools = promptToolList(systemPromptOf(buildClaudeArgs(agent, null, {})));
    expect(tools).toContain("mcp__dashboard__hire_agent");
    expect(tools).toContain("mcp__dashboard__assign_issue");
  });

  it("keeps the prompt tool list identical to the --allowedTools flag", () => {
    const agent = delegator({ canHire: false, canAssign: true });
    const args = buildClaudeArgs(agent, null, {});
    expect(promptToolList(systemPromptOf(args)).sort()).toEqual(allowedToolsOf(args).sort());
  });
});

// Audit 2026-06-03 Inteligência & Contexto M1: composeInstructions can return
// "" (bundle exists but blank), so `?? agent.systemPrompt` doesn't fall back.
// build-args must fall back to agent.systemPrompt on undefined OR blank.
describe("buildClaudeArgs — empty persona falls back to systemPrompt (audit 2026-06-03 M1)", () => {
  it("uses agent.systemPrompt when instructionsBlock is undefined", () => {
    const agent = { ...ceo(), systemPrompt: "FALLBACK_PERSONA_XYZ" };
    const prompt = systemPromptOf(buildClaudeArgs(agent, null, {}));
    expect(prompt).toContain("FALLBACK_PERSONA_XYZ");
  });

  it("uses agent.systemPrompt when instructionsBlock is blank (empty/whitespace)", () => {
    const agent = { ...ceo(), systemPrompt: "FALLBACK_PERSONA_XYZ" };
    const prompt = systemPromptOf(buildClaudeArgs(agent, null, { instructionsBlock: "   \n  " }));
    expect(prompt).toContain("FALLBACK_PERSONA_XYZ");
  });

  it("uses instructionsBlock when it is non-blank", () => {
    const agent = { ...ceo(), systemPrompt: "FALLBACK_PERSONA_XYZ" };
    const prompt = systemPromptOf(
      buildClaudeArgs(agent, null, { instructionsBlock: "BUNDLE_PERSONA_ABC" }),
    );
    expect(prompt).toContain("BUNDLE_PERSONA_ABC");
    expect(prompt).not.toContain("FALLBACK_PERSONA_XYZ");
  });
});

// Onda A #2 (token): the genesis playbook (~4.5 KB) is only needed while the
// company is being created (business not yet approved). After approval it is
// dead weight on every steady-state CEO turn, so it is dropped once we KNOW the
// business is approved. Fail-safe: absent flag => keep it (never drop planning
// guidance we're unsure about, incl. the [BUSINESS_PLAN_FEEDBACK] resubmit loop).
describe("buildClaudeArgs — genesis block gated to the genesis phase (Onda A #2)", () => {
  it("includes the genesis playbook for the CEO by default (flag absent = fail-safe)", () => {
    const prompt = systemPromptOf(buildClaudeArgs(ceo(), null, {}));
    expect(prompt).toContain("Creating the business (genesis)");
  });

  it("includes the genesis playbook while the business is not yet approved", () => {
    const prompt = systemPromptOf(
      buildClaudeArgs(ceo(), null, { companyHasApprovedBusiness: false }),
    );
    expect(prompt).toContain("Creating the business (genesis)");
  });

  it("DROPS the genesis playbook once the business is approved, keeping org + goals", () => {
    const prompt = systemPromptOf(
      buildClaudeArgs(ceo(), null, { companyHasApprovedBusiness: true }),
    );
    expect(prompt).not.toContain("Creating the business (genesis)");
    // ...but the always-needed org + goals playbooks stay.
    expect(prompt).toContain("Designing the organization");
    expect(prompt).toContain("Goals & Planning");
  });
});

// Audit 2026-06-03 Inteligência & Contexto I2: the narrated block is injected
// only when narratedActive===true (respawn.ts resolves this host-side via the
// goals repo). Guard the contract here since respawn.ts isn't unit-tested.
describe("buildClaudeArgs — narrated block gating (audit 2026-06-03 I2)", () => {
  it("emits the narrated block when narratedActive===true", () => {
    const prompt = systemPromptOf(buildClaudeArgs(ceo(), null, { narratedActive: true }));
    expect(prompt).toContain("Narrated Plan Execution");
  });

  it("omits the narrated block by default", () => {
    const prompt = systemPromptOf(buildClaudeArgs(ceo(), null, {}));
    expect(prompt).not.toContain("Narrated Plan Execution");
  });
});
