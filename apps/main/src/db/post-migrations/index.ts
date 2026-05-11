import type Database from "better-sqlite3";
import { runPostMigration0002 } from "./0002.js";
import { runPostMigration0003 } from "./0003.js";

const SCRIPTS: Array<{ id: number; run: (db: Database.Database) => void }> = [
  { id: 2, run: runPostMigration0002 },
  { id: 3, run: runPostMigration0003 },
];

export const runPostMigrations = (db: Database.Database): void => {
  for (const s of SCRIPTS) s.run(db);
};
