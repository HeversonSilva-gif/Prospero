import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0002 } from "../src/db/post-migrations/0002.js";

const seed = (db: Database.Database, opts: { workspaceCwd?: string }) => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Acme', 0)").run();
  if (opts.workspaceCwd !== undefined) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('workspaceCwd', ?)").run(
      opts.workspaceCwd,
    );
  }
};

describe("postMigration 0002", () => {
  it("creates Default Workspace when company has no projects and workspaceCwd is set", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, { workspaceCwd: "C:/work/repo" });

    runPostMigration0002(db);

    const projects = db
      .prepare("SELECT name, path, color FROM projects WHERE company_id = 'c1'")
      .all() as { name: string; path: string; color: string }[];
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual({
      name: "Default Workspace",
      path: "C:/work/repo",
      color: "#1D5DD7",
    });
  });

  it("is a noop when company already has projects", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, { workspaceCwd: "C:/work/repo" });
    db.prepare(
      "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES ('p_existing', 'c1', 'Existing', '/x', '#000', 0)",
    ).run();

    runPostMigration0002(db);

    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM projects WHERE company_id = 'c1'").get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it("is idempotent — running twice does not duplicate", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, { workspaceCwd: "C:/work/repo" });

    runPostMigration0002(db);
    runPostMigration0002(db);

    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM projects WHERE company_id = 'c1'").get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it("skips company without workspaceCwd", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, {});

    runPostMigration0002(db);

    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM projects WHERE company_id = 'c1'").get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });
});
