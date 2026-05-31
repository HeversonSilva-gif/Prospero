import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBusinessContext,
  BUSINESS_CONTEXT_CAP,
  gatherBusinessContext,
} from "./business-context.js";
import { applyMigrations } from "../db/migrations.js";

describe("buildBusinessContext", () => {
  it("assembles company name, X handle, and TELOS into one block", () => {
    const out = buildBusinessContext({
      companyName: "BeanBox",
      xHandle: "@beanbox",
      telos: "## Mission\n\nSell single-origin coffee subscriptions.",
    });
    expect(out).toContain("# This business");
    expect(out).toContain("BeanBox");
    expect(out).toContain("@beanbox");
    expect(out).toContain("Sell single-origin coffee subscriptions");
    expect(out).toContain("TELOS");
  });

  it("returns an empty string when nothing is known", () => {
    expect(buildBusinessContext({ companyName: null, xHandle: null, telos: null })).toBe("");
  });

  it("degrades gracefully when only the TELOS is missing", () => {
    const out = buildBusinessContext({ companyName: "BeanBox", xHandle: null, telos: null });
    expect(out).toContain("BeanBox");
    expect(out).not.toContain("TELOS");
  });

  it("caps the TELOS body length", () => {
    const out = buildBusinessContext({
      companyName: null,
      xHandle: null,
      telos: "x".repeat(BUSINESS_CONTEXT_CAP + 500),
    });
    // The block has a fixed header + the capped telos; assert the telos slice is capped.
    expect(out.length).toBeLessThan(BUSINESS_CONTEXT_CAP + 100);
  });
});

describe("gatherBusinessContext", () => {
  it("reads company name + X @handle from the db (TELOS absent → omitted)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','BeanBox',0)").run();
    db.prepare(
      `INSERT INTO connections (id, company_id, kind, ciphertext, metadata_json, created_at, updated_at)
       VALUES ('cn1','c1','x','xxx', ?, 0, 0)`,
    ).run(JSON.stringify({ handle: "@beanbox" }));
    const emptyDir = mkdtempSync(join(tmpdir(), "ud-")); // no telos.md → readTelos returns null
    const out = gatherBusinessContext(db, emptyDir, "c1");
    expect(out).toContain("BeanBox");
    expect(out).toContain("@beanbox");
    expect(out).not.toContain("TELOS");
  });

  it("does not throw when the x connection has no metadata_json (NULL)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','BeanBox',0)").run();
    db.prepare(
      `INSERT INTO connections (id, company_id, kind, ciphertext, created_at, updated_at)
       VALUES ('cn1','c1','x','xxx', 0, 0)`,
    ).run(); // metadata_json defaults to NULL
    const dir = mkdtempSync(join(tmpdir(), "ud-"));
    const out = gatherBusinessContext(db, dir, "c1");
    expect(out).toContain("BeanBox");
    expect(out).not.toContain("@");
  });

  it("returns an empty string for a null companyId", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const dir = mkdtempSync(join(tmpdir(), "ud-"));
    expect(gatherBusinessContext(db, dir, null)).toBe("");
  });
});
