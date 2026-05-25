/**
 * Regression tests for MarkdownContent.
 *
 * Strategy: use react-dom/server's renderToStaticMarkup to produce an HTML
 * string in Node.js — no jsdom, no browser APIs needed.  We test two axes:
 *
 *  1. Markdown rendering — bold, italic, lists, code, links, headings, GFM
 *  2. XSS sanitization  — script injection, javascript: hrefs, iframe, event
 *     handlers.  Content from LLMs/agents must be treated as untrusted.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MarkdownContent } from "./MarkdownContent.js";

// Shorthand — renders as agent bubble (default)
const render = (content: string, isUser = false): string =>
  renderToStaticMarkup(createElement(MarkdownContent, { content, isUser }));

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

describe("MarkdownContent — markdown rendering", () => {
  it("renders plain text without wrapping markup", () => {
    const html = render("hello world");
    expect(html).toContain("hello world");
  });

  it("renders bold with <strong>", () => {
    const html = render("**bold text**");
    // The component adds Tailwind classes, so we check tag presence + content separately
    expect(html).toContain("<strong");
    expect(html).toContain("bold text");
    expect(html).toContain("</strong>");
  });

  it("renders italic with <em>", () => {
    const html = render("_italic_");
    expect(html).toContain("<em");
    expect(html).toContain("italic");
    expect(html).toContain("</em>");
  });

  it("renders GFM strikethrough with <del>", () => {
    const html = render("~~struck~~");
    expect(html).toContain("<del");
    expect(html).toContain("struck");
  });

  it("renders unordered list items", () => {
    const html = render("- alpha\n- beta\n- gamma");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
  });

  it("renders ordered list items", () => {
    const html = render("1. first\n2. second");
    expect(html).toContain("<ol");
    expect(html).toContain("first");
    expect(html).toContain("second");
  });

  it("renders inline code with <code>", () => {
    const html = render("call `console.log()` here");
    expect(html).toContain("<code");
    expect(html).toContain("console.log()");
  });

  it("renders fenced code block with <pre><code>", () => {
    const html = render("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });

  it("renders h1 heading", () => {
    const html = render("# Big title");
    expect(html).toContain("<h1");
    expect(html).toContain("Big title");
  });

  it("renders h2 heading", () => {
    const html = render("## Section");
    expect(html).toContain("<h2");
    expect(html).toContain("Section");
  });

  it("renders h3 heading", () => {
    const html = render("### Sub");
    expect(html).toContain("<h3");
  });

  it("renders links with https href, target=_blank and noopener", () => {
    const html = render("[Prospero](https://prospero.app)");
    expect(html).toContain('href="https://prospero.app"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders blockquotes", () => {
    const html = render("> quoted text");
    expect(html).toContain("<blockquote");
    expect(html).toContain("quoted text");
  });

  it("renders GFM table", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    const html = render(md);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
  });

  it("renders multiple paragraphs separately", () => {
    const html = render("First para.\n\nSecond para.");
    // Two <p> elements
    expect((html.match(/<p/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("isUser=true renders without crashing", () => {
    expect(() => render("**user bold**", true)).not.toThrow();
    const html = render("**user bold**", true);
    expect(html).toContain("<strong");
    expect(html).toContain("user bold");
    expect(html).toContain("</strong>");
  });
});

// ---------------------------------------------------------------------------
// XSS sanitization
// ---------------------------------------------------------------------------

describe("MarkdownContent — XSS sanitization", () => {
  it("strips <script> tags entirely", () => {
    const html = render("<script>alert('xss')</script>safe text");
    expect(html).not.toContain("<script");
    // The text content of a script tag should also not appear
    expect(html).not.toContain("alert('xss')");
  });

  it("strips javascript: href from links", () => {
    const html = render("[click me](javascript:alert('xss'))");
    expect(html).not.toContain("javascript:");
  });

  it("strips inline event handlers (onclick)", () => {
    const html = render('<a onclick="alert(1)" href="https://safe.com">x</a>');
    expect(html).not.toContain("onclick");
  });

  it("strips inline event handlers (onerror on img)", () => {
    const html = render('<img src="x" onerror="alert(1)">text');
    expect(html).not.toContain("onerror");
  });

  it("strips <iframe> elements", () => {
    const html = render('<iframe src="https://evil.com"></iframe>safe');
    expect(html).not.toContain("<iframe");
  });

  it("strips <object> elements", () => {
    const html = render('<object data="evil.swf"></object>safe');
    expect(html).not.toContain("<object");
  });

  it("strips data: URIs from hrefs", () => {
    const html = render("[click](data:text/html,<script>alert(1)</script>)");
    expect(html).not.toContain("data:");
  });

  it("preserves safe https links after sanitization", () => {
    const html = render("[safe](https://example.com)");
    expect(html).toContain("https://example.com");
  });
});
