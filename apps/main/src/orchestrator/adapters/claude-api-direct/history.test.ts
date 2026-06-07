import { describe, expect, it } from "vitest";
import { reconstructMessages } from "./history.js";

describe("reconstructMessages", () => {
  it("maps persisted turns to SDK messages oldest-first, capped by char budget", () => {
    const turns = [
      { role: "user" as const, text: "a".repeat(10) },
      { role: "assistant" as const, text: "b".repeat(10) },
    ];
    expect(reconstructMessages(turns, 1000)).toEqual([
      { role: "user", content: "aaaaaaaaaa" },
      { role: "assistant", content: "bbbbbbbbbb" },
    ]);
  });
  it("drops oldest turns to fit the char budget (keeps the tail)", () => {
    const turns = [
      { role: "user" as const, text: "x".repeat(900) },
      { role: "assistant" as const, text: "y".repeat(900) },
    ];
    expect(reconstructMessages(turns, 1000)).toEqual([
      { role: "assistant", content: "y".repeat(900) },
    ]);
  });
  it("returns [] for no turns (fresh session)", () => {
    expect(reconstructMessages([], 1000)).toEqual([]);
  });
});
