import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const runPostMigration0002 = (db: Database.Database): void => {
  const companies = db.prepare("SELECT id FROM companies").all() as { id: string }[];
  const wsRow = db.prepare("SELECT value FROM settings WHERE key = 'workspaceCwd'").get() as
    | { value: string }
    | undefined;
  const wsCwd = wsRow?.value;

  const countProjects = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE company_id = ?");
  const insertProject = db.prepare(
    "INSERT INTO projects (id, company_id, name, path, color, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const tx = db.transaction(() => {
    for (const c of companies) {
      const n = (countProjects.get(c.id) as { n: number }).n;
      if (n === 0 && wsCwd !== undefined && wsCwd.trim() !== "") {
        insertProject.run(
          `proj_${randomUUID()}`,
          c.id,
          "Default Workspace",
          wsCwd,
          "#1D5DD7",
          Date.now(),
        );
      }
    }
  });
  tx();
};
