import type Database from "better-sqlite3";

// Backfills projects.slug + issues.issue_number + issues.identifier for rows
// that existed before migration 0005. Idempotent via post_migration_0005_done
// settings flag.
//
// Slug derivation:
//   * Take the project name, strip non-alphanumeric, uppercase, truncate to 6.
//   * Collisions within a company resolve in created_at order: first wins the
//     bare slug, subsequent ones get -2, -3, etc.
//
// Issue numbering:
//   * For each project, order existing issues by (created_at ASC, id ASC) and
//     assign 1..N. Identifier = `${slug}-${n}` when the project has a slug;
//     null otherwise. Issues with project_id IS NULL stay null.

const FLAG_KEY = "post_migration_0005_done";

const deriveSlug = (name: string): string => {
  const cleaned = name
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6);
  return cleaned === "" ? "PROJ" : cleaned;
};

type ProjectRow = {
  id: string;
  company_id: string;
  name: string;
  slug: string | null;
  created_at: number;
};

type IssueRow = {
  id: string;
  project_id: string;
  created_at: number;
};

export const runPostMigration0005 = (db: Database.Database): void => {
  const done = db.prepare("SELECT value FROM settings WHERE key = ?").get(FLAG_KEY) as
    | { value: string }
    | undefined;
  if (done !== undefined) return;

  const allProjects = db
    .prepare(
      "SELECT id, company_id, name, slug, created_at FROM projects ORDER BY company_id ASC, created_at ASC",
    )
    .all() as ProjectRow[];

  const tx = db.transaction(() => {
    const slugByCompany = new Map<string, Set<string>>();

    for (const p of allProjects) {
      if (p.slug !== null && p.slug !== "") {
        // Project already has a slug — respect it. Register so unslugged
        // followers detect the collision.
        let set = slugByCompany.get(p.company_id);
        if (set === undefined) {
          set = new Set();
          slugByCompany.set(p.company_id, set);
        }
        set.add(p.slug);
        continue;
      }
      const base = deriveSlug(p.name);
      let set = slugByCompany.get(p.company_id);
      if (set === undefined) {
        set = new Set();
        slugByCompany.set(p.company_id, set);
      }
      let candidate = base;
      let suffix = 2;
      while (set.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
      }
      set.add(candidate);
      db.prepare("UPDATE projects SET slug = ? WHERE id = ?").run(candidate, p.id);
    }

    const projectsWithSlug = db
      .prepare("SELECT id, slug FROM projects WHERE slug IS NOT NULL")
      .all() as Array<{ id: string; slug: string }>;

    const updateIssue = db.prepare(
      "UPDATE issues SET issue_number = ?, identifier = ? WHERE id = ?",
    );

    for (const proj of projectsWithSlug) {
      const issues = db
        .prepare(
          "SELECT id, project_id, created_at FROM issues WHERE project_id = ? ORDER BY created_at ASC, id ASC",
        )
        .all(proj.id) as IssueRow[];
      let n = 1;
      for (const issue of issues) {
        updateIssue.run(n, `${proj.slug}-${n}`, issue.id);
        n += 1;
      }
    }

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FLAG_KEY, "1");
  });

  tx();
};
