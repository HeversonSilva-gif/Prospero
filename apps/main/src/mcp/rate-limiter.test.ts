import { describe, it, expect, vi, afterEach } from "vitest";
import { createRateLimiter } from "./rate-limiter.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRateLimiter", () => {
  it("allows up to max consumptions in the window", () => {
    const rl = createRateLimiter(3, 120_000);
    expect(rl.tryConsume("a")).toBe(true);
    expect(rl.tryConsume("a")).toBe(true);
    expect(rl.tryConsume("a")).toBe(true);
    expect(rl.tryConsume("a")).toBe(false);
  });

  it("tracks keys independently", () => {
    const rl = createRateLimiter(1, 120_000);
    expect(rl.tryConsume("a")).toBe(true);
    expect(rl.tryConsume("b")).toBe(true);
    expect(rl.tryConsume("a")).toBe(false);
  });

  it("frees a slot once the window elapses", () => {
    vi.useFakeTimers();
    const rl = createRateLimiter(1, 120_000);
    expect(rl.tryConsume("a")).toBe(true);
    expect(rl.tryConsume("a")).toBe(false);
    vi.advanceTimersByTime(120_001);
    expect(rl.tryConsume("a")).toBe(true);
  });
});
