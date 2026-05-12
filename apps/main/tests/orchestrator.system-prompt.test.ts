import { describe, expect, it } from "vitest";
import { composeSystemPrompt, buildAgentSystemPrompt } from "../src/orchestrator/system-prompt.js";

describe("composeSystemPrompt", () => {
  it("uses preambleOverride when provided (no fs read)", () => {
    const result = composeSystemPrompt({
      agentPersona: "I am a test agent.",
      skills: [],
      preambleOverride: "# Custom preamble\n\n",
    });
    expect(result).toContain("# Custom preamble");
    expect(result).toContain("I am a test agent.");
    expect(result).toContain("# Your skills and available tools");
  });

  it("emits a role block when role is provided", () => {
    const result = composeSystemPrompt({
      agentPersona: "Persona text.",
      skills: ["chat"],
      role: { name: "Engineer", description: "Builds things." },
      preambleOverride: "PREAMBLE\n",
    });
    expect(result).toContain("# Your role: Engineer");
    expect(result).toContain("Builds things.");
  });

  it("omits the role block when role is null", () => {
    const result = composeSystemPrompt({
      agentPersona: "P",
      skills: [],
      role: null,
      preambleOverride: "PRE\n",
    });
    expect(result).not.toContain("# Your role:");
  });

  it("ensures chat skill is in the list even if not explicitly provided", () => {
    const result = composeSystemPrompt({
      agentPersona: "P",
      skills: ["coding"],
      preambleOverride: "PRE\n",
    });
    expect(result).toContain("chat");
  });

  it("buildAgentSystemPrompt wrapper produces equivalent output for skills+persona", () => {
    const wrapper = buildAgentSystemPrompt("Persona text", ["chat"]);
    const direct = composeSystemPrompt({ agentPersona: "Persona text", skills: ["chat"] });
    expect(wrapper).toBe(direct);
  });

  it("loads the bundled preamble.md from disk when no override given", () => {
    const result = composeSystemPrompt({ agentPersona: "X", skills: [] });
    expect(result).toContain("Runtime environment");
  });
});
