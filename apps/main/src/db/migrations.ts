import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const getCurrentVersion = (db: Database.Database): number => {
  const result = db.pragma("user_version", { simple: true });
  return typeof result === "number" ? result : 0;
};

const setVersion = (db: Database.Database, version: number): void => {
  db.pragma(`user_version = ${version}`);
};

const loadMigrations = (): { id: number; sql: string }[] => {
  const dir = resolve(__dirname, "migrations");
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return files.map((f) => {
    const id = Number.parseInt(f.slice(0, 4), 10);
    const sql = readFileSync(join(dir, f), "utf8");
    return { id, sql };
  });
};

export const applyMigrations = (db: Database.Database): number[] => {
  const current = getCurrentVersion(db);
  const all = loadMigrations();
  const pending = all.filter((m) => m.id > current);

  const tx = db.transaction((migrations: { id: number; sql: string }[]) => {
    for (const m of migrations) {
      db.exec(m.sql);
      setVersion(db, m.id);
    }
  });
  tx(pending);

  return pending.map((m) => m.id);
};
