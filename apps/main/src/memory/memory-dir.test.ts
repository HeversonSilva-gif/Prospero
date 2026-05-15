import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMemoryRootDir,
  getCompanyMemoryDir,
  getAgentMemoryDir,
  skillBodyPath,
} from "./memory-dir.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "prospero-memdir-"));

describe("memory-dir", () => {
  it("getMemoryRootDir creates userData/memory", () => {
    const ud = tmp();
    const dir = getMemoryRootDir(ud);
    expect(dir).toBe(join(ud, "memory"));
    expect(existsSync(dir)).toBe(true);
  });

  it("getCompanyMemoryDir nests under companies/<id>", () => {
    const ud = tmp();
    const dir = getCompanyMemoryDir(ud, "co_1");
    expect(dir).toBe(join(ud, "memory", "companies", "co_1"));
    expect(existsSync(dir)).toBe(true);
  });

  it("getAgentMemoryDir nests under companies/<id>/agents/<agentId>", () => {
    const ud = tmp();
    const dir = getAgentMemoryDir(ud, "co_1", "agent_9");
    expect(dir).toBe(join(ud, "memory", "companies", "co_1", "agents", "agent_9"));
    expect(existsSync(dir)).toBe(true);
  });

  it("skillBodyPath points at skills/<name>/SKILL.md inside a scope dir", () => {
    const scope = "/x/memory/companies/co_1";
    expect(skillBodyPath(scope, "deploy-runbook")).toBe(
      join(scope, "skills", "deploy-runbook", "SKILL.md"),
    );
  });
});
