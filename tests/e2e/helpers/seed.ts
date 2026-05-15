// Seeds the SQLite DB directly (not through IPC) for tests that need
// preconditions like "company exists with CEO already hired". The Electron
// app is launched against the same DB file via PROSPERO_USER_DATA.
//
// Imports are lazy so this module loads cleanly under Playwright's CJS
// runner even when the suite is skipped — without it, top-level ESM-only
// imports from the main app (import.meta.url usage) crash the test
// discovery pass.

import Database from "better-sqlite3";

export type SeedOptions = {
  companyId?: string;
  companyName?: string;
  withCeo?: boolean;
  ceoId?: string;
  projectSlug?: string;
};

export const dbPathOf = (userDataDir: string): string => `${userDataDir}/prospero.db`;

export const seedDb = async (dbPath: string, opts: SeedOptions = {}): Promise<void> => {
  const { applyMigrations } = await import("../../../apps/main/src/db/migrations.js");
  const { runPostMigrations } = await import("../../../apps/main/src/db/post-migrations/index.js");

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
          status, model, capabilities_json, template_id, reports_to, adapter_name,
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
