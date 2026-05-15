import type Database from "better-sqlite3";
import { DEFAULT_SETTINGS, type AppSettings, type ExecutorMode } from "@prospero/shared";
import { AppSettingsSchema } from "./schema.js";

const KEY = "app-settings";

export type SettingsRepository = {
  read(): AppSettings;
  write(patch: Partial<AppSettings>): void;
  getExecutorMode(): ExecutorMode;
  setExecutorMode(mode: ExecutorMode): void;
};

export const createSettingsRepository = (db: Database.Database): SettingsRepository => {
  const selectStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertStmt = db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  const read = (): AppSettings => {
    const row = selectStmt.get(KEY) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(row.value) as unknown;
      const result = AppSettingsSchema.safeParse(parsed);
      return result.success ? result.data : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };

  const write = (patch: Partial<AppSettings>): void => {
    const current = read();
    const next = { ...current, ...patch };
    const validated = AppSettingsSchema.safeParse(next);
    const value = validated.success ? validated.data : current;
    upsertStmt.run(KEY, JSON.stringify(value));
  };

  const getExecutorMode = (): ExecutorMode => read().executorMode;

  const setExecutorMode = (mode: ExecutorMode): void => {
    if (mode !== "atomic" && mode !== "narrated") {
      throw new Error(`invalid executor mode: ${String(mode)}`);
    }
    write({ executorMode: mode });
  };

  return { read, write, getExecutorMode, setExecutorMode };
};
