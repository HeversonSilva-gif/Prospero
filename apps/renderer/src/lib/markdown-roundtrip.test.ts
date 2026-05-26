// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { roundtrip } from "./markdown-roundtrip.js";

describe("markdown roundtrip via TipTap", () => {
  const same = (md: string): void => expect(roundtrip(md).trim()).toBe(md.trim());

  it("bold", () => same("**hello**"));
  it("italic", () => same("*hello*"));
  it("strike", () => same("~~hello~~"));
  it("link", () => same("[click](https://x.com)"));
  it("inline code", () => same("`code`"));
  it("blockquote", () => same("> quoted line"));
  it("bullet list", () => same("- one\n- two"));
  it("ordered list", () => same("1. one\n2. two"));
  it("nested list", () => same("- a\n  - b"));
  it("fenced code block", () => {
    const md = "```js\nconst x = 1;\n```";
    expect(roundtrip(md)).toContain("const x = 1;");
  });
  it("empty input → empty output", () => {
    expect(roundtrip("").trim()).toBe("");
  });
  it("bold inside list item", () => {
    same("- **first** item");
  });
});

describe("underline (HTML, non-standard markdown)", () => {
  it("preserves <u> tag", () => {
    expect(roundtrip("<u>x</u>")).toContain("<u>x</u>");
  });
});
