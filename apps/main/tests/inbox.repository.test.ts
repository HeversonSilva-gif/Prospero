import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createInboxRepository } from "../src/inbox/repository.js";
import { createDemoCompany } from "../src/companies/seed.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createDemoCompany(db);
  return { repo: createInboxRepository(db), companyId: company.id };
};

describe("inbox repository", () => {
  it("create + listByCompany", () => {
    const { repo, companyId } = setup();
    repo.create({ companyId, kind: "completed", title: "Done" });
    const items = repo.listByCompany(companyId);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("completed");
    expect(items[0]?.title).toBe("Done");
  });

  it("returns DESC order (newest first)", () => {
    const { repo, companyId } = setup();
    repo.create({ companyId, kind: "completed", title: "A" });
    // small delay so created_at differs
    const start = Date.now();
    while (Date.now() === start) {
      /* spin */
    }
    repo.create({ companyId, kind: "completed", title: "B" });
    const items = repo.listByCompany(companyId);
    expect(items[0]?.title).toBe("B");
    expect(items[1]?.title).toBe("A");
  });

  it("requiresAction defaults to false; explicit true persists", () => {
    const { repo, companyId } = setup();
    const a = repo.create({
      companyId,
      kind: "approval",
      title: "Need approval",
      requiresAction: true,
    });
    const b = repo.create({ companyId, kind: "completed", title: "Done" });
    expect(a.requiresAction).toBe(true);
    expect(b.requiresAction).toBe(false);
  });
});
