import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createXPostsRepository } from "./x-posts-repository.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

describe("x-posts-repository", () => {
  it("records a posted tweet and lists it back, newest first, within the window", () => {
    const repo = createXPostsRepository(newDb());
    repo.record({ companyId: "c1", tweetId: "t1", text: "first", postedAt: 1000 });
    repo.record({ companyId: "c1", tweetId: "t2", text: "second", postedAt: 2000 });
    const recent = repo.recentByCompany("c1", 0);
    expect(recent.map((p) => p.tweetId)).toEqual(["t2", "t1"]);
  });
  it("excludes posts older than the since cutoff", () => {
    const repo = createXPostsRepository(newDb());
    repo.record({ companyId: "c1", tweetId: "old", text: "x", postedAt: 100 });
    repo.record({ companyId: "c1", tweetId: "new", text: "y", postedAt: 5000 });
    expect(repo.recentByCompany("c1", 1000).map((p) => p.tweetId)).toEqual(["new"]);
  });
  it("is idempotent: recording the same tweet_id twice does not throw or duplicate", () => {
    // M4 (audit 2026-06-03 Conectores): tweet_id is now UNIQUE; a replayed record
    // must be a no-op rather than a constraint error or a duplicate row.
    const repo = createXPostsRepository(newDb());
    repo.record({ companyId: "c1", tweetId: "t1", text: "first", postedAt: 1000 });
    expect(() =>
      repo.record({ companyId: "c1", tweetId: "t1", text: "second", postedAt: 2000 }),
    ).not.toThrow();
    expect(repo.recentByCompany("c1", 0)).toHaveLength(1);
  });
});
