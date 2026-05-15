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
});
