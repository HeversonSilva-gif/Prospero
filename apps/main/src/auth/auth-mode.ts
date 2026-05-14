import type Database from "better-sqlite3";
import { createSettingsRepository } from "../settings/repository.js";

export type AuthMode = "oauth" | "api-key";

export const getActiveAuthMode = (db: Database.Database): AuthMode =>
  createSettingsRepository(db).read().authMode;
