import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Company } from "@prospero/shared";

export type CompaniesRepository = {
  create(input: { name: string }): Company;
  getById(id: string): Company | null;
  list(): Company[];
  delete(id: string): void;
  setTelosPath(id: string, telosPath: string): void;
  setBriefingReviewedAt(id: string, reviewedAt: number): void;
  setBriefingHeadline(id: string, json: string): void;
  getBriefingHeadlineRaw(id: string): string | null;
  rename(id: string, name: string): void;
  setBrandIdentity(id: string, identity: { voice: string; proposedXHandle: string }): void;
};

type CompanyRow = {
  id: string;
  name: string;
  created_at: number;
  telos_path: string | null;
  briefing_reviewed_at: number | null;
};

const rowToCompany = (row: CompanyRow): Company => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  telosPath: row.telos_path,
  briefingReviewedAt: row.briefing_reviewed_at,
});

export const createCompaniesRepository = (db: Database.Database): CompaniesRepository => {
  const insertStmt = db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)");
  const selectByIdStmt = db.prepare(
    "SELECT id, name, created_at, telos_path, briefing_reviewed_at FROM companies WHERE id = ?",
  );
  const listStmt = db.prepare(
    "SELECT id, name, created_at, telos_path, briefing_reviewed_at FROM companies ORDER BY created_at ASC",
  );
  const deleteStmt = db.prepare("DELETE FROM companies WHERE id = ?");
  const setTelosPathStmt = db.prepare("UPDATE companies SET telos_path = ? WHERE id = ?");
  const setBriefingReviewedAtStmt = db.prepare(
    "UPDATE companies SET briefing_reviewed_at = ? WHERE id = ?",
  );
  const setBriefingHeadlineStmt = db.prepare(
    "UPDATE companies SET briefing_headline_json = ? WHERE id = ?",
  );
  const getBriefingHeadlineStmt = db.prepare(
    "SELECT briefing_headline_json AS json FROM companies WHERE id = ?",
  );
  const renameStmt = db.prepare("UPDATE companies SET name = ? WHERE id = ?");
  const setBrandIdentityStmt = db.prepare(
    "UPDATE companies SET brand_voice = ?, proposed_x_handle = ? WHERE id = ?",
  );

  return {
    create(input) {
      const id = `co_${randomUUID()}`;
      const now = Date.now();
      insertStmt.run(id, input.name, now);
      return { id, name: input.name, createdAt: now, telosPath: null, briefingReviewedAt: null };
    },
    getById(id) {
      const row = selectByIdStmt.get(id) as CompanyRow | undefined;
      return row ? rowToCompany(row) : null;
    },
    list() {
      const rows = listStmt.all() as CompanyRow[];
      return rows.map(rowToCompany);
    },
    delete(id) {
      deleteStmt.run(id);
    },
    setTelosPath(id, telosPath) {
      setTelosPathStmt.run(telosPath, id);
    },
    setBriefingReviewedAt(id, reviewedAt) {
      setBriefingReviewedAtStmt.run(reviewedAt, id);
    },
    setBriefingHeadline(id, json) {
      setBriefingHeadlineStmt.run(json, id);
    },
    getBriefingHeadlineRaw(id) {
      const row = getBriefingHeadlineStmt.get(id) as { json: string | null } | undefined;
      return row?.json ?? null;
    },
    rename(id, name) {
      renameStmt.run(name, id);
    },
    setBrandIdentity(id, identity) {
      setBrandIdentityStmt.run(identity.voice, identity.proposedXHandle, id);
    },
  };
};
