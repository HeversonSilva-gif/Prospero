import { describe, it, expect, vi } from "vitest";
import { collectXMetrics } from "./collect-x-metrics.js";
import { XApiError } from "./x-client.js";

const baseDeps = () => ({
  listCompaniesWithX: () => ["c1", "c2"],
  getToken: vi.fn((companyId: string) => Promise.resolve(companyId === "c2" ? null : "AT")),
  getUserMetrics: vi.fn(() => Promise.resolve({ followers: 100, following: 1, tweets: 5 })),
  recentPosts: vi.fn(() => [{ tweetId: "t1", text: "x", postedAt: 0 }]),
  getTweetMetrics: vi.fn(() =>
    Promise.resolve([{ id: "t1", impressions: 9, likes: 1, replies: 0, reposts: 0, quotes: 0 }]),
  ),
  insertAccount: vi.fn(),
  insertTweet: vi.fn(),
  now: () => 1234,
});

describe("collectXMetrics", () => {
  it("collects account + tweet snapshots for connected companies, skips the unconnected one", async () => {
    const d = baseDeps();
    await collectXMetrics(d);
    // c1 connected → account + tweet snapshot; c2 token null → skipped
    expect(d.insertAccount).toHaveBeenCalledTimes(1);
    expect(d.insertAccount).toHaveBeenCalledWith({
      companyId: "c1",
      followers: 100,
      capturedAt: 1234,
    });
    expect(d.insertTweet).toHaveBeenCalledTimes(1);
    expect(d.getUserMetrics).toHaveBeenCalledTimes(1); // not for c2
  });

  it("is fail-soft: one company throwing does not stop the others or escape as a throw", async () => {
    const d = baseDeps();
    // Make getUserMetrics always reject so every company will fail
    d.getUserMetrics = vi.fn(() => Promise.reject(new Error("api down")));
    // collectXMetrics must resolve (not throw) even when all companies fail
    await expect(collectXMetrics(d)).resolves.toBeUndefined();
    // No successful insertAccount calls since all errored
    expect(d.insertAccount).not.toHaveBeenCalled();
  });

  it("is fail-soft even if listing the companies throws (the tick never escapes)", async () => {
    // M5 (audit 2026-06-03 Conectores): listCompaniesWithX ran OUTSIDE the
    // per-company try/catch, so a failure there killed the whole tick. It must be
    // swallowed like any other collection error.
    const d = baseDeps();
    d.listCompaniesWithX = () => {
      throw new Error("db locked");
    };
    await expect(collectXMetrics(d)).resolves.toBeUndefined();
    expect(d.getToken).not.toHaveBeenCalled();
  });

  it("backs off on a 429: stops the tick gracefully and does not hit the next company", async () => {
    // I8 (audit 2026-06-03 Conectores): a 429 is rate-limit-wide, so once X says
    // "slow down" we end this tick rather than hammering the remaining companies.
    const d = baseDeps();
    const onRateLimited = vi.fn();
    d.getUserMetrics = vi.fn(() =>
      Promise.reject(Object.assign(new XApiError(429, "rate limited"), { retryAfterMs: 60_000 })),
    );
    await expect(collectXMetrics({ ...d, onRateLimited })).resolves.toBeUndefined();
    // c1 hit the 429 → we stop; c2 is never queried this tick
    expect(d.getUserMetrics).toHaveBeenCalledTimes(1);
    expect(onRateLimited).toHaveBeenCalledWith(60_000);
  });
});
