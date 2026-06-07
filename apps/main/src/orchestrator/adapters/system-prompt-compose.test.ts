import { describe, expect, it } from "vitest";
import type { Agent } from "@prospero/shared";
import {
  composeAgentSystemPrompt,
  composeAgentSystemPromptSplit,
} from "./system-prompt-compose.js";

// Minimal agent shape — composeAgentSystemPrompt reads role/templateId (isCeoAgent),
// capabilities, systemPrompt, canHire, canAssign. role=engineer → non-CEO branch.
const agent = {
  id: "a1",
  companyId: "c1",
  role: "engineer",
  templateId: null,
  capabilities: ["fs-read", "chat"],
  systemPrompt: "You are an engineer persona.",
  canHire: false,
  canAssign: false,
} as unknown as Agent;

const opts = {
  telosBlock: "\n\n# TELOS\n\ncompany north star",
  memoryBlock: "\n\n# DIGEST\n\nvolatile digest content",
  projectContextBlock: "\n\n# PROJECTS\n\nproject ctx",
};

describe("composeAgentSystemPromptSplit", () => {
  it("stable + volatile is byte-identical to the combined prompt (no content/order change)", () => {
    const { stable, volatile } = composeAgentSystemPromptSplit(agent, opts);
    expect(stable + volatile).toBe(composeAgentSystemPrompt(agent, opts));
  });

  it("puts the volatile blocks (digest/telos/project context) in volatile, not stable", () => {
    const { stable, volatile } = composeAgentSystemPromptSplit(agent, opts);
    expect(volatile).toContain("volatile digest content");
    expect(volatile).toContain("company north star");
    expect(volatile).toContain("project ctx");
    // the digest must NOT be in the cached prefix (that's the whole point)
    expect(stable).not.toContain("volatile digest content");
    // the persona IS in the stable prefix
    expect(stable).toContain("engineer persona");
  });

  it("empty opts → empty volatile and stable === the full prompt", () => {
    const { stable, volatile } = composeAgentSystemPromptSplit(agent);
    expect(volatile).toBe("");
    expect(stable).toBe(composeAgentSystemPrompt(agent));
  });
});
