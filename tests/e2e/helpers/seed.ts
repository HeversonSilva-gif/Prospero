import Database from "better-sqlite3";
import { applyMigrations } from "../../../apps/main/src/db/migrations.js";
import { runPostMigrations } from "../../../apps/main/src/db/post-migrations/index.js";

// Seeds the SQLite DB directly (not through IPC) for tests that need
// preconditions like "company exists with CEO already hired". The Electron
// app is launched against the same DB file via DASHBOARD_AGENT_USER_DATA.

export type SeedOptions = {
  companyId?: string;
  companyName?: string;
  withCeo?: boolean;
  ceoId?: string;
  projectSlug?: string;
};

export const dbPathOf = (userDataDir: string): string => `${userDataDir}/dashboard-agent.db`;

export const seedDb = (dbPath: string, opts: SeedOptions = {}): void => {
  const db = new Database(dbPath);
  try {
    applyMigrations(db);
    runPostMigrations(db);

    const companyId = opts.companyId ?? "co_e2e_1";
    const companyName = opts.companyName ?? "E2E Co";
    db.prepare("INSERT OR IGNORE INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
      companyId,
      companyName,
      Date.now(),
    );

    if (opts.withCeo === true) {
      const ceoId = opts.ceoId ?? "agent_e2e_ceo";
      db.prepare(
        `INSERT OR IGNORE INTO agents (
          id, company_id, name, role, system_prompt, mode, always_on,
          status, model, skills_json, template_id, reports_to, adapter_name,
          allowed_projects_json, created_at
        ) VALUES (?, ?, 'CEO', 'Chief Executive Officer', 'You are CEO.', 'supervised', 0,
          'idle', 'claude-sonnet-4-6', '[]', 'role_ceo', NULL, 'claude-oauth-local',
          '[]', ?)`,
      ).run(ceoId, companyId, Date.now());
    }

    if (opts.projectSlug !== undefined) {
      db.prepare(
        `INSERT OR IGNORE INTO projects (id, company_id, name, slug, root_path, created_at)
         VALUES (?, ?, ?, ?, '', ?)`,
      ).run("proj_e2e_1", companyId, "E2E Project", opts.projectSlug, Date.now());
    }
  } finally {
    db.close();
  }
};
