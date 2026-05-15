import { describe, expect, it } from "vitest";
import { composeSystemPrompt, buildAgentSystemPrompt } from "../src/orchestrator/system-prompt.js";

describe("composeSystemPrompt", () => {
  it("uses preambleOverride when provided (no fs read)", () => {
    const result = composeSystemPrompt({
      agentPersona: "I am a test agent.",
      capabilities: [],
      preambleOverride: "# Custom preamble\n\n",
    });
    expect(result).toContain("# Custom preamble");
    expect(result).toContain("I am a test agent.");
    expect(result).toContain("# Your capabilities and available tools");
  });

  it("emits a role block when role is provided", () => {
    const result = composeSystemPrompt({
      agentPersona: "Persona text.",
      capabilities: ["chat"],
      role: { name: "Engineer", description: "Builds things." },
      preambleOverride: "PREAMBLE\n",
    });
    expect(result).toContain("# Your role: Engineer");
    expect(result).toContain("Builds things.");
  });

  it("omits the role block when role is null", () => {
    const result = composeSystemPrompt({
      agentPersona: "P",
      capabilities: [],
      role: null,
      preambleOverride: "PRE\n",
    });
    expect(result).not.toContain("# Your role:");
  });

  it("ensures chat capability is in the list even if not explicitly provided", () => {
    const result = composeSystemPrompt({
      agentPersona: "P",
      capabilities: ["coding"],
      preambleOverride: "PRE\n",
    });
    expect(result).toContain("chat");
  });

  it("buildAgentSystemPrompt wrapper produces equivalent output for capabilities+persona", () => {
    const wrapper = buildAgentSystemPrompt("Persona text", ["chat"]);
    const direct = composeSystemPrompt({ agentPersona: "Persona text", capabilities: ["chat"] });
    expect(wrapper).toBe(direct);
  });

  it("loads the bundled preamble.md from disk when no override given", () => {
    const result = composeSystemPrompt({ agentPersona: "X", capabilities: [] });
    expect(result).toContain("Runtime environment");
  });

  it("appends the memory block when provided", () => {
    const result = composeSystemPrompt({
      agentPersona: "P",
      capabilities: [],
      preambleOverride: "PRE\n",
      memoryBlock: "\n---\n\n# Memory & skills\n\nMEMORY-MARKER\n",
    });
    expect(result).toContain("MEMORY-MARKER");
  });

  it("omits the memory section when no block is given", () => {
    const result = composeSystemPrompt({
      agentPersona: "P",
      capabilities: [],
      preambleOverride: "PRE\n",
    });
    expect(result).not.toContain("# Memory & skills");
  });
});
