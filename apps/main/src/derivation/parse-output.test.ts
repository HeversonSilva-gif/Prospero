import { describe, it, expect } from "vitest";
import { parseDerivationOutput } from "./parse-output.js";

describe("parseDerivationOutput", () => {
  it("parses a fenced JSON skill block", () => {
    const text =
      'Here is the skill:\n```json\n{"name":"redis-pool-tuning","description":"raise the pool","body":"1. measure\\n2. raise"}\n```';
    const out = parseDerivationOutput(text);
    expect(out).toEqual({
      kind: "skill",
      draft: {
        name: "redis-pool-tuning",
        description: "raise the pool",
        body: "1. measure\n2. raise",
      },
    });
  });

  it("treats a bare DISCARD as a discard", () => {
    expect(parseDerivationOutput("DISCARD")).toEqual({ kind: "discard" });
  });

  it("treats output with no JSON block as a discard", () => {
    expect(parseDerivationOutput("I think this is not worth saving.")).toEqual({
      kind: "discard",
    });
  });

  it("treats a JSON block missing required fields as a discard", () => {
    const text = '```json\n{"name":"x"}\n```';
    expect(parseDerivationOutput(text)).toEqual({ kind: "discard" });
  });

  it("treats a malformed JSON block as a discard", () => {
    const text = "```json\n{not json}\n```";
    expect(parseDerivationOutput(text)).toEqual({ kind: "discard" });
  });

  it("normalizes a non-kebab name and over-long description", () => {
    const text = `\`\`\`json\n{"name":"Redis Pool!","description":"${"d".repeat(300)}","body":"steps"}\n\`\`\``;
    const out = parseDerivationOutput(text);
    expect(out.kind).toBe("skill");
    if (out.kind === "skill") {
      expect(out.draft.name).toBe("redis-pool");
      expect(out.draft.description.length).toBe(200);
    }
  });
});
