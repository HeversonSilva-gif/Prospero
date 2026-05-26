// Pure helper: run a markdown string through TipTap (parse → re-serialize) and
// return the canonical markdown form.  Used in tests to guarantee the
// composer's TipTap pipeline does not lose information for the markdown
// subset we accept from agents (bold, italic, strike, link, inline code,
// blockquote, bullet/ordered/nested lists, fenced code, and the non-standard
// <u> tag for underline).
//
// Creates and destroys a fresh Editor on every call so callers do not have to
// manage lifecycle.  Requires a DOM (TipTap uses ProseMirror under the hood);
// in tests we opt-in via `// @vitest-environment happy-dom`.
//
// Note: StarterKit v3 already bundles Link and Underline extensions, so we
// don't add them again (would trigger a "Duplicate extension names" warning).
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

const makeEditor = (): Editor =>
  new Editor({
    extensions: [StarterKit, Markdown],
    content: "",
  });

// tiptap-markdown attaches `markdown.getMarkdown()` to `editor.storage` at
// runtime but does not extend the `Storage` interface — narrow it here.
interface MarkdownStorage {
  markdown: { getMarkdown: () => string };
}

export const roundtrip = (markdown: string): string => {
  const editor = makeEditor();
  editor.commands.setContent(markdown);
  const out = (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown();
  editor.destroy();
  return out;
};
