import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createXMetricsRepository } from "./x-metrics-repository.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  return db;
};

describe("x-metrics-repository", () => {
  it("inserts account snapshots and returns the latest", () => {
    const repo = createXMetricsRepository(newDb());
    repo.insertAccount({ companyId: "c1", followers: 100, capturedAt: 1000 });
    repo.insertAccount({ companyId: "c1", followers: 120, capturedAt: 2000 });
    expect(repo.latestAccount("c1")?.followers).toBe(120);
  });
  it("inserts tweet snapshots and returns a series for one tweet", () => {
    const repo = createXMetricsRepository(newDb());
    repo.insertTweet({
      companyId: "c1",
      tweetId: "t1",
      impressions: 10,
      likes: 1,
      replies: 0,
      reposts: 0,
      quotes: 0,
      capturedAt: 1000,
    });
    repo.insertTweet({
      companyId: "c1",
      tweetId: "t1",
      impressions: 50,
      likes: 4,
      replies: 1,
      reposts: 0,
      quotes: 0,
      capturedAt: 2000,
    });
    const series = repo.tweetSeries("c1", "t1", 0);
    expect(series.map((s) => s.impressions)).toEqual([10, 50]);
  });
});
