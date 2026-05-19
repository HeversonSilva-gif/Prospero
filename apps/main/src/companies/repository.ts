import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Company } from "@prospero/shared";

export type CompaniesRepository = {
  create(input: { name: string }): Company;
  getById(id: string): Company | null;
  list(): Company[];
  delete(id: string): void;
  setTelosPath(id: string, telosPath: string): void;
};

const rowToCompany = (row: {
  id: string;
  name: string;
  created_at: number;
  telos_path: string | null;
}): Company => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  telosPath: row.telos_path,
});

export const createCompaniesRepository = (db: Database.Database): CompaniesRepository => {
  const insertStmt = db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)");
  const selectByIdStmt = db.prepare(
    "SELECT id, name, created_at, telos_path FROM companies WHERE id = ?",
  );
  const listStmt = db.prepare(
    "SELECT id, name, created_at, telos_path FROM companies ORDER BY created_at ASC",
  );
  const deleteStmt = db.prepare("DELETE FROM companies WHERE id = ?");
  const setTelosPathStmt = db.prepare("UPDATE companies SET telos_path = ? WHERE id = ?");

  return {
    create(input) {
      const id = `co_${randomUUID()}`;
      const now = Date.now();
      insertStmt.run(id, input.name, now);
      return { id, name: input.name, createdAt: now, telosPath: null };
    },
    getById(id) {
      const row = selectByIdStmt.get(id) as
        | { id: string; name: string; created_at: number; telos_path: string | null }
        | undefined;
      return row ? rowToCompany(row) : null;
    },
    list() {
      const rows = listStmt.all() as {
        id: string;
        name: string;
        created_at: number;
        telos_path: string | null;
      }[];
      return rows.map(rowToCompany);
    },
    delete(id) {
      deleteStmt.run(id);
    },
    setTelosPath(id, telosPath) {
      setTelosPathStmt.run(telosPath, id);
    },
  };
};
