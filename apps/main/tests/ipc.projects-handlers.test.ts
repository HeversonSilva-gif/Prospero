import { describe, expect, it, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn(() => Promise.resolve("")) },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("projects handlers — channel registration", () => {
  it("registers the 6 project channels", async () => {
    const { ipcMain } = await import("electron");
    const { registerProjectsHandlers } = await import("../src/ipc/projects-handlers.js");
    const db = new Database(":memory:");
    applyMigrations(db);
    registerProjectsHandlers(db);
    const channels = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(channels).toEqual([
      "projects:list",
      "projects:create",
      "projects:update",
      "projects:delete",
      "projects:open-folder",
      "projects:check-paths",
    ]);
  });

  it("projects:create persists and projects:list returns it", async () => {
    const { ipcMain } = await import("electron");
    const { registerProjectsHandlers } = await import("../src/ipc/projects-handlers.js");
    const db = new Database(":memory:");
    applyMigrations(db);
    const c = createCompaniesRepository(db).create({ name: "Acme" });
    registerProjectsHandlers(db);
    const calls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    type Handler = (e: unknown, payload: unknown) => unknown;
    const createHandler = calls.find((x) => x[0] === "projects:create")![1] as Handler;
    const listHandler = calls.find((x) => x[0] === "projects:list")![1] as Handler;
    await createHandler({}, { companyId: c.id, name: "Web", path: "C:/w", color: "#1D5DD7" });
    const list = (await listHandler({}, { companyId: c.id })) as { name: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("Web");
  });
});
