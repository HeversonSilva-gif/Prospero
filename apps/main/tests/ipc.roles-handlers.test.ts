import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0004 } from "../src/db/post-migrations/0004.js";

type Handler = (e: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, h: Handler) => {
      handlers.set(channel, h);
    },
  },
}));

import { registerRolesHandlers } from "../src/ipc/roles-handlers.js";

beforeEach(() => {
  handlers.clear();
});

const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const h = handlers.get(channel);
  if (h === undefined) throw new Error(`no handler for ${channel}`);
  return await h(null, ...args);
};

describe("roles IPC handlers", () => {
  it("roles:list returns the 5 seeded roles with agent counts", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'A', 0)").run();
    runPostMigration0004(db);
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, template_id, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1', 'c1', 'X', 'r', 'role-engineer', 'sp', '[]', '[]', 'supervised', 0, 'idle', 0, 0)`,
    ).run();

    registerRolesHandlers(db);
    const list = (await invoke("roles:list")) as Array<{ id: string; agentCount: number }>;
    expect(list).toHaveLength(5);
    const eng = list.find((r) => r.id === "role-engineer")!;
    expect(eng.agentCount).toBe(1);
    const ceo = list.find((r) => r.id === "role-ceo")!;
    expect(ceo.agentCount).toBe(0);
  });

  it("roles:get returns RoleDetail with resolvedTools and agentsUsing", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'A', 0)").run();
    runPostMigration0004(db);
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, template_id, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1', 'c1', 'Alice', 'r', 'role-engineer', 'sp', '[]', '[]', 'supervised', 0, 'idle', 0, 0)`,
    ).run();
    registerRolesHandlers(db);

    const detail = (await invoke("roles:get", { id: "role-engineer" })) as {
      id: string;
      defaultCapabilities: string[];
      resolvedTools: string[];
      agentsUsing: Array<{ id: string; name: string }>;
    } | null;

    expect(detail).not.toBeNull();
    expect(detail!.defaultCapabilities).toContain("shell");
    expect(detail!.resolvedTools).toContain("Bash");
    expect(detail!.resolvedTools).toContain("mcp__dashboard__request_permission");
    expect(detail!.agentsUsing).toEqual([{ id: "a1", name: "Alice" }]);
  });

  it("roles:get returns null for unknown id", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'A', 0)").run();
    runPostMigration0004(db);
    registerRolesHandlers(db);

    const result = await invoke("roles:get", { id: "role-does-not-exist" });
    expect(result).toBeNull();
  });
});
