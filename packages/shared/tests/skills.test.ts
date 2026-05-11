import { describe, it, expect } from "vitest";
import {
  KNOWN_CLAUDE_TOOLS,
  SKILL_CATALOG,
  ensureChatSkill,
  skillsToTools,
  resolveSkillTools,
} from "../src/skills.js";

describe("skill catalog", () => {
  it("includes the 8 canonical skill ids", () => {
    expect(Object.keys(SKILL_CATALOG).sort()).toEqual([
      "chat",
      "delegation",
      "fs-read",
      "fs-write",
      "inbox",
      "issues",
      "shell",
      "web",
    ]);
  });

  it("every built-in tool in KNOWN_CLAUDE_TOOLS is mapped by at least one skill", () => {
    const mapped = new Set<string>();
    for (const skill of Object.values(SKILL_CATALOG)) {
      for (const t of skill.tools) mapped.add(t);
    }
    for (const tool of KNOWN_CLAUDE_TOOLS) {
      expect(mapped.has(tool), `tool "${tool}" has no skill mapping`).toBe(true);
    }
  });
});

describe("ensureChatSkill", () => {
  it("adds 'chat' when missing", () => {
    expect(ensureChatSkill(["shell"]).sort()).toEqual(["chat", "shell"]);
  });

  it("does not duplicate 'chat' when present", () => {
    expect(ensureChatSkill(["chat", "shell"]).sort()).toEqual(["chat", "shell"]);
  });

  it("preserves order otherwise", () => {
    expect(ensureChatSkill(["shell", "fs-read"])).toEqual(["shell", "fs-read", "chat"]);
  });
});

describe("skillsToTools", () => {
  it("returns Bash for shell skill", () => {
    expect(skillsToTools(["shell"])).toContain("Bash");
  });

  it("returns Read, Glob, Grep for fs-read", () => {
    const tools = skillsToTools(["fs-read"]);
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
  });

  it("returns Edit, Write, NotebookEdit for fs-write", () => {
    const tools = skillsToTools(["fs-write"]);
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("NotebookEdit");
  });

  it("returns WebFetch, WebSearch for web", () => {
    const tools = skillsToTools(["web"]);
    expect(tools).toContain("WebFetch");
    expect(tools).toContain("WebSearch");
  });

  it("returns mcp__dashboard__hire_agent etc for delegation", () => {
    const tools = skillsToTools(["delegation"]);
    expect(tools).toContain("mcp__dashboard__hire_agent");
    expect(tools).toContain("mcp__dashboard__message_agent");
    expect(tools).toContain("mcp__dashboard__list_agents");
  });

  it("returns mcp__dashboard__create_issue etc for issues", () => {
    const tools = skillsToTools(["issues"]);
    expect(tools).toContain("mcp__dashboard__create_issue");
    expect(tools).toContain("mcp__dashboard__update_issue");
  });

  it("returns request_permission for chat skill", () => {
    expect(skillsToTools(["chat"])).toEqual(["mcp__dashboard__request_permission"]);
  });

  it("ignores unknown skill ids (does not throw)", () => {
    const tools = skillsToTools(["shell", "totally-fake-skill"]);
    expect(tools).toContain("Bash");
  });

  it("deduplicates when two skills map to overlapping tools (none today, but pattern-test)", () => {
    const tools = skillsToTools(["shell", "shell"]);
    const bashCount = tools.filter((t) => t === "Bash").length;
    expect(bashCount).toBe(1);
  });
});

describe("resolveSkillTools (full resolver with chat safety-net)", () => {
  it("auto-injects chat skill if missing", () => {
    const tools = resolveSkillTools(["shell"]);
    expect(tools).toContain("Bash");
    expect(tools).toContain("mcp__dashboard__request_permission");
  });

  it("empty skill list still gets request_permission via chat safety-net", () => {
    expect(resolveSkillTools([])).toEqual(["mcp__dashboard__request_permission"]);
  });
});
