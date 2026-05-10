import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPermissionWatcher } from "../src/security/permission-watcher.js";
import type { Agent } from "@dashboard-agent/shared";

const agent: Agent = {
  id: "a1",
  companyId: "c1",
  name: "Alice",
  role: "FE",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
};

describe(
  "permission-watcher",
  () => {
    it("auto-allows when gate returns allow", async () => {
      const dir = mkdtempSync(join(tmpdir(), "pw-"));
      const stop = startPermissionWatcher({
        dir,
        getAgent: () => ({ ...agent, mode: "auto" }),
        getAllowedProjectPaths: (_agentId: string) => ["C:\\Workspace"],
        onUserDecision: vi.fn(),
      });

      // small delay to let chokidar initialize
      await new Promise((r) => setTimeout(r, 200));

      writeFileSync(
        join(dir, "tu1.req.json"),
        JSON.stringify({
          tool_use_id: "tu1",
          agentId: "a1",
          tool_name: "Bash",
          tool_input: { command: "echo hi" },
        }),
      );
      await new Promise((r) => setTimeout(r, 500));
      const resPath = join(dir, "tu1.res.json");
      expect(existsSync(resPath)).toBe(true);
      expect(JSON.parse(readFileSync(resPath, "utf8"))).toEqual({ behavior: "allow" });

      await stop();
      rmSync(dir, { recursive: true, force: true });
    });

    it("auto-denies when path outside workspace", async () => {
      const dir = mkdtempSync(join(tmpdir(), "pw-"));
      const stop = startPermissionWatcher({
        dir,
        getAgent: () => ({ ...agent, mode: "auto" }),
        getAllowedProjectPaths: (_agentId: string) => ["C:\\Workspace"],
        onUserDecision: vi.fn(),
      });

      await new Promise((r) => setTimeout(r, 200));

      writeFileSync(
        join(dir, "tu2.req.json"),
        JSON.stringify({
          tool_use_id: "tu2",
          agentId: "a1",
          tool_name: "Read",
          tool_input: { file_path: "/etc/passwd" },
        }),
      );
      await new Promise((r) => setTimeout(r, 500));
      const denyPath = join(dir, "tu2.deny.json");
      expect(existsSync(denyPath)).toBe(true);
      const body = JSON.parse(readFileSync(denyPath, "utf8")) as {
        behavior: string;
        message: string;
      };
      expect(body.behavior).toBe("deny");
      expect(body.message).toMatch(/outside allowed projects/i);

      await stop();
      rmSync(dir, { recursive: true, force: true });
    });

    it("invokes onResolved when res.json appears", async () => {
      const dir = mkdtempSync(join(tmpdir(), "pw-"));
      const onResolved = vi.fn();
      const stop = startPermissionWatcher({
        dir,
        getAgent: () => agent,
        getAllowedProjectPaths: (_agentId: string) => ["C:\\Workspace"],
        onUserDecision: vi.fn(),
        onResolved,
      });
      await new Promise((r) => setTimeout(r, 200));
      writeFileSync(join(dir, "tu99.res.json"), JSON.stringify({ behavior: "allow" }));
      await new Promise((r) => setTimeout(r, 500));
      expect(onResolved).toHaveBeenCalledWith("tu99", { behavior: "allow" });
      await stop();
      rmSync(dir, { recursive: true, force: true });
    });

    it("calls onUserDecision callback for request_user", async () => {
      const dir = mkdtempSync(join(tmpdir(), "pw-"));
      const onUserDecision = vi.fn();
      const stop = startPermissionWatcher({
        dir,
        getAgent: () => agent,
        getAllowedProjectPaths: (_agentId: string) => ["C:\\Workspace"],
        onUserDecision,
      });

      await new Promise((r) => setTimeout(r, 200));

      writeFileSync(
        join(dir, "tu3.req.json"),
        JSON.stringify({
          tool_use_id: "tu3",
          agentId: "a1",
          tool_name: "Edit",
          tool_input: { file_path: "C:\\Workspace\\x.ts" },
        }),
      );
      await new Promise((r) => setTimeout(r, 500));
      expect(onUserDecision).toHaveBeenCalledWith(
        expect.objectContaining({ toolUseId: "tu3", agentId: "a1", toolName: "Edit" }),
        expect.stringMatching(/supervised/i),
      );

      await stop();
      rmSync(dir, { recursive: true, force: true });
    });
  },
  { timeout: 10_000 },
);
