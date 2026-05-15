import type Database from "better-sqlite3";
import { safeStorage } from "electron";
import { readFileSync } from "node:fs";
import type { ApiKeyStatus } from "@prospero/shared";
import { isWellFormedApiKey } from "./api-key-validate.js";

const KEY_CIPHERTEXT = "auth.apikey.ciphertext";
const KEY_PREFIX = "auth.apikey.prefix";
const KEY_AT = "auth.apikey.configured_at";

const upsert = (db: Database.Database, key: string, value: string): void => {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
};

const select = (db: Database.Database, key: string): string | null => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
};

const remove = (db: Database.Database, key: string): void => {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
};

// Show "sk-ant-api03-…XXXX" — first 12 chars + last 4. Never the full key.
const maskApiKey = (raw: string): string => {
  if (raw.length <= 16) return "sk-ant-api…";
  return `${raw.slice(0, 12)}…${raw.slice(-4)}`;
};

export const saveApiKey = (db: Database.Database, raw: string): void => {
  const trimmed = raw.trim();
  if (!isWellFormedApiKey(trimmed)) {
    throw new Error("API key is not well-formed");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption is not available on this machine");
  }
  const cipher = safeStorage.encryptString(trimmed);
  const tx = db.transaction(() => {
    upsert(db, KEY_CIPHERTEXT, cipher.toString("base64"));
    upsert(db, KEY_PREFIX, maskApiKey(trimmed));
    upsert(db, KEY_AT, String(Date.now()));
  });
  tx();
};

export const loadApiKeyStatus = (db: Database.Database): ApiKeyStatus => {
  const cipher = select(db, KEY_CIPHERTEXT);
  if (cipher === null) return { hasKey: false };
  const prefix = select(db, KEY_PREFIX);
  const at = select(db, KEY_AT);
  if (prefix === null || at === null) return { hasKey: false };
  return { hasKey: true, maskedPrefix: prefix, configuredAt: Number.parseInt(at, 10) };
};

export const loadDecryptedApiKey = (db: Database.Database): string | null => {
  // E2E bypass mirrors token-storage.ts: read plaintext from a file when env var is set.
  const e2ePath = process.env["PROSPERO_E2E_API_KEY_PATH"];
  if (e2ePath !== undefined && e2ePath !== "") {
    try {
      return readFileSync(e2ePath, "utf8").trim();
    } catch {
      return null;
    }
  }
  const cipher64 = select(db, KEY_CIPHERTEXT);
  if (cipher64 === null) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(cipher64, "base64"));
};

export const clearApiKey = (db: Database.Database): void => {
  const tx = db.transaction(() => {
    remove(db, KEY_CIPHERTEXT);
    remove(db, KEY_PREFIX);
    remove(db, KEY_AT);
  });
  tx();
};
