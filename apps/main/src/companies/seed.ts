import type Database from "better-sqlite3";
import type { Company } from "@prospero/shared";
import { createCompaniesRepository } from "./repository.js";
import { createCEOAgent } from "../agents/seed.js";

export const createDemoCompany = (db: Database.Database): Company => {
  const repo = createCompaniesRepository(db);
  const company = repo.create({ name: "Demo Company" });
  createCEOAgent(db, company.id);
  return company;
};
