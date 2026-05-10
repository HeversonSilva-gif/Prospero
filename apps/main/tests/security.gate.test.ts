import { describe, expect, it } from "vitest";
import { evaluatePermission } from "../src/security/gate.js";
import type { Agent } from "@dashboard-agent/shared";

const agent = (mode: "supervised" | "auto"): Agent => ({
  id: "a",
  companyId: "c",
  name: "n",
  role: "r",
  systemPrompt: "",
  mode,
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
});

const WS = "C:\\Workspace";

describe("evaluatePermission §1 always-blocked patterns", () => {
  it("Bash credential read → request_user even in auto mode", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "cat ~/.credentials.json" },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("request_user");
    expect(r.reason).toMatch(/always-blocked/i);
  });

  it("Bash rm -rf / → request_user even in auto mode", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("request_user");
  });
});

describe("evaluatePermission §2 path-tool outside workspace", () => {
  it("Read of /etc/passwd → deny", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: "/etc/passwd" },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("deny");
    expect(r.reason).toMatch(/outside workspace/i);
  });

  it("Write to ../../escape.txt → deny", () => {
    const r = evaluatePermission({
      toolName: "Write",
      toolInput: { file_path: "C:\\Workspace\\..\\..\\escape.txt" },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("deny");
  });

  it("Edit inside workspace → allow (auto mode)", () => {
    const r = evaluatePermission({
      toolName: "Edit",
      toolInput: { file_path: "C:\\Workspace\\src\\index.ts" },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("allow");
  });

  it("Edit inside workspace → request_user (supervised)", () => {
    const r = evaluatePermission({
      toolName: "Edit",
      toolInput: { file_path: "C:\\Workspace\\src\\index.ts" },
      agent: agent("supervised"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("request_user");
  });
});

describe("evaluatePermission §3 Bash path extraction", () => {
  it("Bash with cat ~/.ssh/id_rsa → request_user (always-blocked)", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "cat ~/.ssh/id_rsa" },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("request_user");
  });

  it("Bash with absolute path outside workspace → request_user (auto)", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "ls C:\\Users\\Other\\file.txt" },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("request_user");
  });

  it("Bash echo hello (no path-like) → allow in auto", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "echo hello" },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("allow");
  });
});

describe("evaluatePermission §4 non-fs tools (orchestrator MCP)", () => {
  it("hire_agent in auto → allow", () => {
    const r = evaluatePermission({
      toolName: "hire_agent",
      toolInput: { name: "Alice", role: "FE", system_prompt: "..." },
      agent: agent("auto"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("allow");
  });

  it("hire_agent in supervised → request_user", () => {
    const r = evaluatePermission({
      toolName: "hire_agent",
      toolInput: { name: "Alice", role: "FE", system_prompt: "..." },
      agent: agent("supervised"),
      workspaceCwd: WS,
    });
    expect(r.action).toBe("request_user");
  });
});
