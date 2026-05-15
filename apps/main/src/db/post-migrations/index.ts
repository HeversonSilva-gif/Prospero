import type Database from "better-sqlite3";
import { runPostMigration0002 } from "./0002.js";
import { runPostMigration0003 } from "./0003.js";
import { runPostMigration0004 } from "./0004.js";
import { runPostMigration0005 } from "./0005.js";
import { runPostMigration0006 } from "./0006.js";

const SCRIPTS: Array<{ id: number; run: (db: Database.Database) => void }> = [
  { id: 2, run: runPostMigration0002 },
  { id: 3, run: runPostMigration0003 },
  { id: 4, run: runPostMigration0004 },
  { id: 5, run: runPostMigration0005 },
  { id: 6, run: runPostMigration0006 },
];

export const runPostMigrations = (db: Database.Database): void => {
  for (const s of SCRIPTS) s.run(db);
};
