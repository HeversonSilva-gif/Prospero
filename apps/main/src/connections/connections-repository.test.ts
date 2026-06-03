import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import {
  createConnectionsRepository,
  listConnectedChannels,
  type Cipher,
} from "./connections-repository.js";

// Reversible FAKE cipher — proves the repo actually encrypts (stored bytes != the
// plaintext) without needing electron's safeStorage in a unit test. Production wires
// the real safeStorage-backed cipher at the IPC layer; the repo itself is electron-free.
const fakeCipher: Cipher = {
  encrypt: (plain) => `ENC:${Buffer.from(plain).toString("base64")}`,
  decrypt: (b64) => Buffer.from(b64.slice(4), "base64").toString("utf8"),
};

const setup = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  return db;
};

describe("connections-repository", () => {
  it("saves and loads a connection, round-tripping the secret payload + metadata", () => {
    const db = setup();
    const repo = createConnectionsRepository(db, fakeCipher);
    repo.save("c1", "x", { accessToken: "AT", refreshToken: "RT" }, { handle: "@me" });
    const conn = repo.load("c1", "x");
    expect(conn?.payload).toEqual({ accessToken: "AT", refreshToken: "RT" });
    expect(conn?.metadata).toEqual({ handle: "@me" });
    db.close();
  });

  it("listConnectedChannels returns this company's connected kinds (no decrypt, no cross-company)", () => {
    const db = setup();
    const repo = createConnectionsRepository(db, fakeCipher);
    repo.save("c1", "x", { t: 1 }, {});
    repo.save("c1", "email", { t: 2 }, {});
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c2','Other',0)").run();
    createConnectionsRepository(db, fakeCipher).save("c2", "stripe", { t: 3 }, {});
    expect(listConnectedChannels(db, "c1")).toEqual(["email", "x"]); // ORDER BY kind
    expect(listConnectedChannels(db, "c1")).not.toContain("stripe");
    db.close();
  });

  it("encrypts the secret payload at rest (raw ciphertext never contains the plaintext)", () => {
    const db = setup();
    const repo = createConnectionsRepository(db, fakeCipher);
    repo.save("c1", "x", { accessToken: "SUPERSECRET" }, {});
    const raw = db.prepare("SELECT ciphertext FROM connections WHERE company_id='c1'").get() as {
      ciphertext: string;
    };
    expect(raw.ciphertext).not.toContain("SUPERSECRET");
    expect(raw.ciphertext.startsWith("ENC:")).toBe(true);
    db.close();
  });

  it("returns null when there is no connection", () => {
    const db = setup();
    const repo = createConnectionsRepository(db, fakeCipher);
    expect(repo.load("c1", "x")).toBeNull();
    db.close();
  });

  it("upserts — saving again replaces tokens + metadata, keeps one row", () => {
    const db = setup();
    const repo = createConnectionsRepository(db, fakeCipher);
    repo.save("c1", "x", { accessToken: "AT1" }, { handle: "@a" });
    repo.save("c1", "x", { accessToken: "AT2" }, { handle: "@b" });
    expect(repo.load("c1", "x")?.payload).toEqual({ accessToken: "AT2" });
    expect(repo.load("c1", "x")?.metadata).toEqual({ handle: "@b" });
    const count = db.prepare("SELECT COUNT(*) n FROM connections").get() as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });

  it("lists connection metadata for a company WITHOUT decrypting the secrets", () => {
    const db = setup();
    const repo = createConnectionsRepository(db, fakeCipher);
    repo.save("c1", "x", { accessToken: "AT" }, { handle: "@me", clientId: "abc" });
    expect(repo.listMetadata("c1")).toEqual([
      { kind: "x", metadata: { handle: "@me", clientId: "abc" } },
    ]);
    db.close();
  });

  it("clears a connection", () => {
    const db = setup();
    const repo = createConnectionsRepository(db, fakeCipher);
    repo.save("c1", "x", { accessToken: "AT" }, {});
    repo.clear("c1", "x");
    expect(repo.load("c1", "x")).toBeNull();
    db.close();
  });
});
