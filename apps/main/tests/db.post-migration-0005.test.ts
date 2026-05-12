import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigrations } from "../src/db/post-migrations/index.js";

type ProjRow = { id: string; name: string; slug: string | null };
type IssueRow = {
  id: string;
  project_id: string | null;
  identifier: string | null;
  issue_number: number | null;
  created_at: number;
};

const seedBaseline = (db: Database.Database): { companyId: string } => {
  const now = Date.now();
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "co_1",
    "Test Co",
    now,
  );
  return { companyId: "co_1" };
};

describe("post-migration 0005 — backfill identifiers", () => {
  it("derives slug from project name (first 6 alphanumeric, uppercase)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { companyId } = seedBaseline(db);
    db.prepare(
      "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("proj_a", companyId, "Backend Service", "C:/x", "#000", Date.now());
    runPostMigrations(db);
    const row = db.prepare("SELECT id, name, slug FROM projects WHERE id = ?").get("proj_a") as
      | ProjRow
      | undefined;
    expect(row?.slug).toBe("BACKEN");
  });

  it("resolves slug collisions with -2 / -3 suffix in creation order", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { companyId } = seedBaseline(db);
    const t0 = Date.now();
    const insertProj = db.prepare(
      "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insertProj.run("proj_a", companyId, "Backend Service", "C:/a", "#000", t0);
    insertProj.run("proj_b", companyId, "Backend Worker", "C:/b", "#000", t0 + 1);
    insertProj.run("proj_c", companyId, "Backend Logs", "C:/c", "#000", t0 + 2);
    runPostMigrations(db);
    const rows = db
      .prepare("SELECT id, name, slug FROM projects WHERE company_id = ? ORDER BY created_at ASC")
      .all(companyId) as ProjRow[];
    expect(rows.map((r) => r.slug)).toEqual(["BACKEN", "BACKEN-2", "BACKEN-3"]);
  });

  it("backfills issue_number 1..N per project ordered by created_at", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { companyId } = seedBaseline(db);
    db.prepare(
      "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("proj_a", companyId, "Backend", "C:/a", "#000", Date.now());
    const insertIssue = db.prepare(
      "INSERT INTO issues (id, company_id, project_id, title, priority, created_at, updated_at) VALUES (?, ?, ?, ?, 'medium', ?, ?)",
    );
    insertIssue.run("iss_a", companyId, "proj_a", "First", 100, 100);
    insertIssue.run("iss_b", companyId, "proj_a", "Second", 200, 200);
    insertIssue.run("iss_c", companyId, "proj_a", "Third", 300, 300);
    runPostMigrations(db);
    const rows = db
      .prepare(
        "SELECT id, project_id, identifier, issue_number, created_at FROM issues WHERE project_id = ? ORDER BY created_at ASC",
      )
      .all("proj_a") as IssueRow[];
    expect(rows.map((r) => r.issue_number)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.identifier)).toEqual(["BACKEN-1", "BACKEN-2", "BACKEN-3"]);
  });

  it("is idempotent (running twice does not duplicate counters)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { companyId } = seedBaseline(db);
    db.prepare(
      "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("proj_a", companyId, "Backend", "C:/a", "#000", Date.now());
    db.prepare(
      "INSERT INTO issues (id, company_id, project_id, title, priority, created_at, updated_at) VALUES (?, ?, ?, ?, 'medium', ?, ?)",
    ).run("iss_a", companyId, "proj_a", "First", 100, 100);
    runPostMigrations(db);
    runPostMigrations(db);
    const issue = db
      .prepare("SELECT identifier, issue_number FROM issues WHERE id = ?")
      .get("iss_a") as { identifier: string; issue_number: number };
    expect(issue.identifier).toBe("BACKEN-1");
    expect(issue.issue_number).toBe(1);
  });

  it("issues without project keep null identifier", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { companyId } = seedBaseline(db);
    db.prepare(
      "INSERT INTO issues (id, company_id, project_id, title, priority, created_at, updated_at) VALUES (?, ?, NULL, ?, 'medium', ?, ?)",
    ).run("iss_x", companyId, "Orphan", 100, 100);
    runPostMigrations(db);
    const issue = db
      .prepare("SELECT identifier, issue_number FROM issues WHERE id = ?")
      .get("iss_x") as { identifier: string | null; issue_number: number | null };
    expect(issue.identifier).toBeNull();
    expect(issue.issue_number).toBeNull();
  });
});
