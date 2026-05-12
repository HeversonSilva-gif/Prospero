import type Database from "better-sqlite3";
import { safeStorage } from "electron";
import { readFileSync } from "node:fs";
import type { TokenSource, TokenStatus } from "@dashboard-agent/shared";
import { isWellFormedToken } from "./token-validate.js";
import { redactToken } from "./token-redact.js";

const KEY_CIPHERTEXT = "auth.token.ciphertext";
const KEY_SOURCE = "auth.token.source";
const KEY_PREFIX = "auth.token.prefix";
const KEY_AT = "auth.token.configured_at";

type SaveInput = { raw: string; source: TokenSource };

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

export const saveToken = (db: Database.Database, input: SaveInput): void => {
  const raw = input.raw.trim();
  if (!isWellFormedToken(raw)) {
    throw new Error("Token is not well-formed");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption is not available on this machine");
  }
  const cipher = safeStorage.encryptString(raw);
  const tx = db.transaction(() => {
    upsert(db, KEY_CIPHERTEXT, cipher.toString("base64"));
    upsert(db, KEY_SOURCE, input.source);
    upsert(db, KEY_PREFIX, redactToken(raw));
    upsert(db, KEY_AT, String(Date.now()));
  });
  tx();
};

export const loadTokenStatus = (db: Database.Database): TokenStatus => {
  const cipher = select(db, KEY_CIPHERTEXT);
  if (cipher === null) return { hasToken: false };
  const source = select(db, KEY_SOURCE);
  const prefix = select(db, KEY_PREFIX);
  const at = select(db, KEY_AT);
  if (source === null || prefix === null || at === null) return { hasToken: false };
  if (source !== "manual" && source !== "auto-detect") return { hasToken: false };
  return {
    hasToken: true,
    source,
    maskedPrefix: prefix,
    configuredAt: Number.parseInt(at, 10),
  };
};

export const loadDecryptedToken = (db: Database.Database): string | null => {
  // E2E bypass: when DASHBOARD_AGENT_E2E_TOKEN_PATH is set, read a plaintext
  // token from that file. The fake-claude stub (also gated by env var) is the
  // only consumer, so a fake token works.
  const e2eTokenPath = process.env["DASHBOARD_AGENT_E2E_TOKEN_PATH"];
  if (e2eTokenPath !== undefined && e2eTokenPath !== "") {
    try {
      return readFileSync(e2eTokenPath, "utf8").trim();
    } catch {
      return null;
    }
  }
  const cipher64 = select(db, KEY_CIPHERTEXT);
  if (cipher64 === null) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(cipher64, "base64"));
};

export const clearToken = (db: Database.Database): void => {
  const tx = db.transaction(() => {
    remove(db, KEY_CIPHERTEXT);
    remove(db, KEY_SOURCE);
    remove(db, KEY_PREFIX);
    remove(db, KEY_AT);
  });
  tx();
};
