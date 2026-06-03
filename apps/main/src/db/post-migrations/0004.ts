import type Database from "better-sqlite3";

// Seeds the 5 canonical role_templates and backfills agents missing a
// template_id. Idempotent via the post_migration_0004_done settings flag.
//
// Backfill strategy:
//   * Agents with reports_to IS NULL are treated as the company CEO and get
//     role-ceo (with Opus + delegation/issues/inbox/chat/fs-read capabilities).
//   * Other orphan agents (with template_id NULL but reports_to set) are
//     defensively backfilled with role-engineer. This shouldn't occur in
//     practice — M3 only seeded a single CEO — but covers any leftover state.
//   * Agents with a template_id already set are left alone.

const FLAG_KEY = "post_migration_0004_done";

type RoleSeed = {
  id: string;
  name: string;
  description: string;
  default_system_prompt: string;
  default_capabilities_json: string;
  default_model: string;
  icon: string | null;
};

const ROLES: RoleSeed[] = [
  {
    id: "role-ceo",
    name: "CEO",
    description: "Receives requests from the user, delegates work to specialists.",
    default_system_prompt:
      "You are the CEO. Receive user requests via chat, decide whether to handle directly or delegate to a specialist agent, and orchestrate the team. Never execute technical work yourself.",
    default_capabilities_json: JSON.stringify(["delegation", "issues", "inbox", "chat", "fs-read"]),
    // Audit 2026-06-03 Inteligência & Contexto I4: keep the role-ceo seed on the
    // current Opus (4.8) so a CEO hired from this template matches the live
    // onboarding CEO (agents/seed.ts). Post-migration 0008 backfills old rows.
    default_model: "claude-opus-4-8",
    icon: "📋",
  },
  {
    id: "role-engineer",
    name: "Engineer",
    description: "Writes code, runs tests, fixes bugs, closes issues.",
    default_system_prompt:
      "You are an engineer. Write clean code, run tests before declaring done, and reference issue IDs in your commits. Use absolute paths inside allowed project directories.",
    default_capabilities_json: JSON.stringify(["shell", "fs-read", "fs-write", "issues", "chat"]),
    default_model: "claude-sonnet-4-6",
    icon: "👨‍💻",
  },
  {
    id: "role-qa",
    name: "QA",
    description: "Tests features end-to-end and files bug reports.",
    default_system_prompt:
      "You are QA. Run the test suite, exercise the feature manually if needed, and file detailed bug issues. Do not modify code yourself — your fs-read access is for inspection.",
    default_capabilities_json: JSON.stringify(["shell", "fs-read", "issues", "chat"]),
    default_model: "claude-sonnet-4-6",
    icon: "🧪",
  },
  {
    id: "role-designer",
    name: "Designer",
    description: "Proposes mockups, copy, UX feedback.",
    default_system_prompt:
      "You are a designer. Read existing UI code for context, search the web for inspiration, and propose specific changes via issue comments. Do not write code directly.",
    default_capabilities_json: JSON.stringify(["fs-read", "web", "issues", "chat"]),
    default_model: "claude-haiku-4-5-20251001",
    icon: "🎨",
  },
  {
    id: "role-pm",
    name: "PM",
    description: "Coordinates the team, prioritizes the issue queue.",
    default_system_prompt:
      "You are a product manager. Triage the issue backlog, prioritize work, delegate to engineers, and keep the user informed via reports. You do not write code.",
    default_capabilities_json: JSON.stringify(["delegation", "issues", "web", "chat"]),
    default_model: "claude-sonnet-4-6",
    icon: "📊",
  },
];

export const runPostMigration0004 = (db: Database.Database): void => {
  const done = db.prepare("SELECT value FROM settings WHERE key = ?").get(FLAG_KEY) as
    | { value: string }
    | undefined;
  if (done !== undefined) return;

  const upsertRole = db.prepare(
    `INSERT INTO role_templates (id, name, description, default_system_prompt, default_capabilities_json, icon, default_model)
     VALUES (@id, @name, @description, @default_system_prompt, @default_capabilities_json, @icon, @default_model)
     ON CONFLICT(id) DO NOTHING`,
  );
  const setAgentRole = db.prepare(
    `UPDATE agents
     SET template_id = ?, capabilities_json = ?, model = ?
     WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    for (const r of ROLES) {
      upsertRole.run(r);
    }

    const orphans = db
      .prepare("SELECT id, reports_to FROM agents WHERE template_id IS NULL")
      .all() as Array<{ id: string; reports_to: string | null }>;

    const ceoRole = ROLES.find((r) => r.id === "role-ceo")!;
    const engRole = ROLES.find((r) => r.id === "role-engineer")!;

    for (const a of orphans) {
      const role = a.reports_to === null ? ceoRole : engRole;
      setAgentRole.run(role.id, role.default_capabilities_json, role.default_model, a.id);
    }

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(FLAG_KEY, "1");
  });
  tx();
};
