import { describe, it, expect, vi } from "vitest";
import { collectXMetrics } from "./collect-x-metrics.js";

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
});
