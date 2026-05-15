import { describe, expect, it } from "vitest";
import { parseAgentsMd } from "./parser.js";

const HAPPY = `---
company: Acme
projects:
  - name: backend
    path: D:/code/backend
agents:
  - name: Alice
    role: engineer
  - name: Bob
    role: qa
    reports_to: Alice
---

# Free text below is ignored.
`;

describe("parseAgentsMd", () => {
  it("parses a minimal valid AGENTS.md", () => {
    const result = parseAgentsMd(HAPPY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.company).toBe("Acme");
    expect(result.data.projects).toHaveLength(1);
    expect(result.data.projects[0]?.name).toBe("backend");
    expect(result.data.agents).toHaveLength(2);
    expect(result.data.agents[1]?.reports_to).toBe("Alice");
  });
});

describe("parseAgentsMd errors", () => {
  it("rejects missing company", () => {
    const raw = `---
projects: []
agents:
  - name: A
    role: engineer
---
`;
    const result = parseAgentsMd(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/company/);
  });

  it("rejects empty agents list", () => {
    const raw = `---
company: Acme
projects: []
agents: []
---
`;
    const result = parseAgentsMd(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/agents/);
  });

  it("rejects malformed YAML", () => {
    const raw = `---
company: Acme
agents:
  - name: "Alice
---
`;
    const result = parseAgentsMd(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/YAML parse failed/);
  });

  it("rejects missing front-matter entirely", () => {
    const raw = "# just a markdown file, no front-matter\n";
    const result = parseAgentsMd(raw);
    expect(result.ok).toBe(false);
  });
});
