import { describe, expect, it, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: (_name: string) => "/tmp/test-userdata" },
  BrowserWindow: { getAllWindows: () => [] },
}));

beforeEach(() => vi.clearAllMocks());

describe("issues handlers — channel registration", () => {
  it("registers all 7 issue channels", async () => {
    const { ipcMain } = await import("electron");
    const { registerIssuesHandlers } = await import("../src/ipc/issues-handlers.js");
    const db = new Database(":memory:");
    applyMigrations(db);
    createCompaniesRepository(db).create({ name: "Acme" });
    registerIssuesHandlers(db);
    const channels = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(channels).toEqual([
      "issues:list",
      "issues:get",
      "issues:create",
      "issues:update",
      "issues:delete",
      "issues:add-comment",
      "artifacts:list-by-issue",
      "issues:list-criteria-results",
    ]);
  });
});
