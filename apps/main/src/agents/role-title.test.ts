import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createRoleTemplatesRepository } from "./role-templates-repository.js";
import { resolveRoleTitle } from "./role-title.js";

describe("resolveRoleTitle", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
  });

  it("returns the role template's human title for a known id", () => {
    const tpl = createRoleTemplatesRepository(db).create({
      name: "Engenheiro de Backend",
      description: "Builds the API",
      icon: null,
      defaultModel: "claude-sonnet-4-6",
      defaultCapabilities: [],
    });
    expect(resolveRoleTitle(db, tpl.id)).toBe("Engenheiro de Backend");
  });

  it("falls back to the id when the template is missing (never throws)", () => {
    expect(resolveRoleTitle(db, "role_does-not-exist")).toBe("role_does-not-exist");
  });
});
