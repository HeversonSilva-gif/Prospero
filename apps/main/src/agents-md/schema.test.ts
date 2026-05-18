import { describe, it, expect } from "vitest";
import { AgentsMdSchema } from "./schema.js";

const baseAgent = { name: "Ann", role: "Engineer" };

describe("AgentsMdSchema with roles", () => {
  it("accepts a payload with a roles array", () => {
    const result = AgentsMdSchema.safeParse({
      company: "Acme",
      roles: [
        {
          name: "Engineer",
          description: "writes code",
          model: "claude-sonnet-4-6",
          capabilities: ["shell"],
          icon: "👩‍💻",
          charter: "# Engineer\n\n## Identity\n\nbody",
        },
      ],
      agents: [baseAgent],
    });
    expect(result.success).toBe(true);
  });

  it("still accepts a payload with no roles array (back-compat)", () => {
    const result = AgentsMdSchema.safeParse({ company: "Acme", agents: [baseAgent] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.roles).toBeUndefined();
  });

  it("rejects a role with no name", () => {
    const result = AgentsMdSchema.safeParse({
      company: "Acme",
      roles: [{ description: "x" }],
      agents: [baseAgent],
    });
    expect(result.success).toBe(false);
  });
});
