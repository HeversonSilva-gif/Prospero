import { describe, it, expect } from "vitest";
import { buildXInsights } from "./x-insights.js";

describe("buildXInsights", () => {
  it("reports the follower delta and ranks top posts by engagement", () => {
    const digest = buildXInsights({
      accountSeries: [
        { followers: 100, capturedAt: 1000 },
        { followers: 130, capturedAt: 5000 },
      ],
      posts: [
        {
          tweetId: "t1",
          text: "low performer",
          metric: {
            tweetId: "t1",
            impressions: 100,
            likes: 1,
            replies: 0,
            reposts: 0,
            quotes: 0,
            capturedAt: 5000,
          },
        },
        {
          tweetId: "t2",
          text: "the winner post",
          metric: {
            tweetId: "t2",
            impressions: 900,
            likes: 40,
            replies: 5,
            reposts: 8,
            quotes: 2,
            capturedAt: 5000,
          },
        },
      ],
    });
    expect(digest).toContain("+30"); // follower delta
    expect(digest).toContain("the winner post"); // top post surfaced
    // the winner (engagement 55) should appear before the low performer (1)
    expect(digest.indexOf("the winner post")).toBeLessThan(digest.indexOf("low performer"));
  });
  it("degrades to a no-data message when there is nothing yet", () => {
    const digest = buildXInsights({ accountSeries: [], posts: [] });
    expect(digest.toLowerCase()).toContain("sem dados");
  });
});
