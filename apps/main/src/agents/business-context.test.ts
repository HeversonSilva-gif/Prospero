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
      voice: null,
      telos: "## Mission\n\nSell single-origin coffee subscriptions.",
    });
    expect(out).toContain("# This business");
    expect(out).toContain("BeanBox");
    expect(out).toContain("@beanbox");
    expect(out).toContain("Sell single-origin coffee subscriptions");
    expect(out).toContain("TELOS");
  });

  it("returns an empty string when nothing is known", () => {
    expect(
      buildBusinessContext({ companyName: null, xHandle: null, voice: null, telos: null }),
    ).toBe("");
  });

  it("includes the owner profile + recent decisions when present, omits when absent", () => {
    const out = buildBusinessContext({
      companyName: "BeanBox",
      xHandle: null,
      voice: null,
      telos: null,
      ownerProfile: "Direto, valoriza dados.",
      ownerDecisions: [{ tool: "post_to_x", status: "rejected", note: "muito salesy" }],
    });
    expect(out).toContain("Sobre o dono");
    expect(out).toContain("Direto, valoriza dados.");
    expect(out).toContain("Decisões recentes do dono");
    expect(out).toContain('rejeitou post_to_x — "muito salesy"');
    const bare = buildBusinessContext({
      companyName: "BeanBox",
      xHandle: null,
      voice: null,
      telos: null,
    });
    expect(bare).not.toContain("Sobre o dono");
    expect(bare).not.toContain("Decisões recentes");
  });

  it("degrades gracefully when only the TELOS is missing", () => {
    const out = buildBusinessContext({
      companyName: "BeanBox",
      xHandle: null,
      voice: null,
      telos: null,
    });
    expect(out).toContain("BeanBox");
    expect(out).not.toContain("TELOS");
  });

  it("caps the TELOS body length", () => {
    const out = buildBusinessContext({
      companyName: null,
      xHandle: null,
      voice: null,
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

// Task 13: brand voice + handle fallback tests

const dbWith = (setup: (db: Database.Database) => void): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Cozinha de 15',0)").run();
  setup(db);
  return db;
};

it("includes brand voice when set", () => {
  const db = dbWith((d) =>
    d.prepare("UPDATE companies SET brand_voice = 'friendly, short' WHERE id = 'c1'").run(),
  );
  const dir = mkdtempSync(join(tmpdir(), "ud-"));
  expect(gatherBusinessContext(db, dir, "c1")).toContain("friendly, short");
});

it("uses the proposed handle when X is not connected", () => {
  const db = dbWith((d) =>
    d.prepare("UPDATE companies SET proposed_x_handle = '@c15' WHERE id = 'c1'").run(),
  );
  const dir = mkdtempSync(join(tmpdir(), "ud-"));
  expect(gatherBusinessContext(db, dir, "c1")).toContain("@c15");
});

it("prefers the connected X handle over the proposed one", () => {
  const db = dbWith((d) => {
    d.prepare("UPDATE companies SET proposed_x_handle = '@proposed' WHERE id = 'c1'").run();
    d.prepare(
      `INSERT INTO connections (id, company_id, kind, ciphertext, metadata_json, created_at, updated_at)
       VALUES ('cn1','c1','x','x',?,0,0)`,
    ).run(JSON.stringify({ handle: "@real" }));
  });
  const dir = mkdtempSync(join(tmpdir(), "ud-"));
  const ctx = gatherBusinessContext(db, dir, "c1");
  expect(ctx).toContain("@real");
  expect(ctx).not.toContain("@proposed");
});
