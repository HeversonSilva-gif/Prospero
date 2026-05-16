import { describe, it, expect } from "vitest";
import { ActivityPayloads } from "./schemas.js";

describe("ActivityPayloads", () => {
  it("has a schema for agent.recovered accepting an optional issueId", () => {
    const schema = ActivityPayloads["agent.recovered"];
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ issueId: "iss_1" })).toEqual({ issueId: "iss_1" });
  });
});
