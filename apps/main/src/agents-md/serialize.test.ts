import { describe, expect, it } from "vitest";
import { serializeAgentsMd } from "./serialize.js";
import { parseAgentsMd } from "./parser.js";
import type { AgentsMdPayload } from "./schema.js";

const PAYLOAD: AgentsMdPayload = {
  company: "Acme",
  projects: [{ name: "backend", path: "D:/code/backend" }],
  agents: [
    { name: "Alice", role: "engineer", capabilities: ["shell", "fs-read"] },
    { name: "Bob", role: "qa", reports_to: "Alice" },
  ],
};

describe("serializeAgentsMd", () => {
  it("emits valid YAML front-matter parseable back to the same shape", () => {
    const text = serializeAgentsMd(PAYLOAD);
    expect(text.startsWith("---")).toBe(true);
    const parsed = parseAgentsMd(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data).toEqual(PAYLOAD);
  });

  it("round-trips an empty projects array", () => {
    const text = serializeAgentsMd({ ...PAYLOAD, projects: [] });
    const parsed = parseAgentsMd(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.projects).toEqual([]);
  });

  it("round-trips a role with a multi-line charter", () => {
    const payload: AgentsMdPayload = {
      company: "Acme",
      projects: [],
      roles: [
        {
          name: "Engineer",
          description: "writes code",
          model: "claude-sonnet-4-6",
          capabilities: ["shell"],
          icon: "👩‍💻",
          charter: "# Engineer — Role Charter\n\n## Identity\n\nWrites clean code.\n",
        },
      ],
      agents: [{ name: "Ann", role: "Engineer" }],
    };
    const text = serializeAgentsMd(payload);
    const reparsed = parseAgentsMd(text);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.data.roles?.[0]?.name).toBe("Engineer");
    expect(reparsed.data.roles?.[0]?.charter).toContain("## Identity");
  });
});
