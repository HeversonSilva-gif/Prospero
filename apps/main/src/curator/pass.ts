import type Database from "better-sqlite3";
import type { RunDerivationResult } from "../derivation/runner.js";
import { runLifecyclePass } from "./lifecycle.js";
import { runLibrarianFork } from "./librarian.js";
import { buildLibrarianPrompt, type LibrarianSkill } from "./prompts.js";
import { parseProposals } from "./parse-proposals.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FORK_INTERVAL_MS = 7 * DAY_MS;
const LAST_RUN_KEY = "curator_last_run";
const DRY_RUN_KEY = "curator_dry_run";
const DERIVATION_MODEL = "claude-sonnet-4-6";
const MIN_LIBRARY_SIZE = 3;

export type CuratorPassResult = {
  lifecycle: { toStale: number; toArchived: number; revived: number };
  fork: { ran: boolean; proposalsCreated: number; tokens: number };
};

export type RunCuratorPassDeps = {
  db: Database.Database;
  now: number;
  runDerivation: (input: {
    prompt: string;
    model: string;
    env: Record<string, string>;
  }) => Promise<RunDerivationResult>;
  authEnv: () => Record<string, string>;
};

const readSetting = (db: Database.Database, key: string): string | undefined => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
};

const writeSetting = (db: Database.Database, key: string, value: string): void => {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
};

// The whole Curator tick. Lifecycle runs every call (cheap); the librarian fork
// is throttled to 7 days via `curator_last_run`. Dry-run (`curator_dry_run`='1')
// runs the fork and logs what it would propose, but persists nothing and does
// not advance the throttle.
export const runCuratorPass = async (deps: RunCuratorPassDeps): Promise<CuratorPassResult> => {
  const { db, now } = deps;
  const lifecycle = runLifecyclePass(db, now);

  const dryRun = readSetting(db, DRY_RUN_KEY) === "1";
  const last = Number(readSetting(db, LAST_RUN_KEY) ?? "0");
  const due = !Number.isFinite(last) || now - last >= FORK_INTERVAL_MS;

  if (!due && !dryRun) {
    return { lifecycle, fork: { ran: false, proposalsCreated: 0, tokens: 0 } };
  }

  const companyIds = (db.prepare("SELECT id FROM companies").all() as { id: string }[]).map(
    (c) => c.id,
  );

  if (dryRun) {
    let total = 0;
    for (const companyId of companyIds) {
      const rows = db
        .prepare(
          "SELECT id, name, description, use_count, view_count, patch_count, trust, lifecycle_state, body_path " +
            "FROM skills WHERE company_id = ? AND soft_deleted = 0 AND lifecycle_state != 'archived'",
        )
        .all(companyId) as Array<Record<string, unknown>>;
      if (rows.length < MIN_LIBRARY_SIZE) continue;
      const skills: LibrarianSkill[] = rows.map((r) => ({
        id: r["id"] as string,
        name: r["name"] as string,
        description: r["description"] as string,
        useCount: r["use_count"] as number,
        viewCount: r["view_count"] as number,
        patchCount: r["patch_count"] as number,
        trust: r["trust"] as number,
        lifecycleState: r["lifecycle_state"] as LibrarianSkill["lifecycleState"],
        body: "",
      }));
      const result = await deps.runDerivation({
        prompt: buildLibrarianPrompt(skills),
        model: DERIVATION_MODEL,
        env: deps.authEnv(),
      });
      const known = new Set(rows.map((r) => r["id"] as string));
      const proposals = parseProposals(result.text, known);
      total += proposals.length;
      console.warn(
        `[curator] dry-run company ${companyId}: ${proposals.length} proposal(s) — ${JSON.stringify(proposals.map((p) => ({ kind: p.kind, rationale: p.rationale })))}`,
      );
    }
    return { lifecycle, fork: { ran: true, proposalsCreated: 0, tokens: total } };
  }

  let proposalsCreated = 0;
  let tokens = 0;
  let forkRan = false;
  for (const companyId of companyIds) {
    const r = await runLibrarianFork({
      db,
      companyId,
      runDerivation: deps.runDerivation,
      authEnv: deps.authEnv,
      now: () => now,
    });
    forkRan = forkRan || r.ran;
    proposalsCreated += r.proposalsCreated;
    tokens += r.tokens;
  }
  writeSetting(db, LAST_RUN_KEY, String(now));
  return { lifecycle, fork: { ran: forkRan, proposalsCreated, tokens } };
};
