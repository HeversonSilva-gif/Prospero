/**
 * MarkdownContent — renders LLM/agent message text as formatted markdown.
 *
 * Security model:
 *  - react-markdown never calls dangerouslySetInnerHTML; all output goes
 *    through React's createElement, so injected markup cannot execute.
 *  - rehype-sanitize runs an allowlist pass over the HAST before React
 *    elements are created, removing any elements/attributes not in the
 *    default schema (strips <script>, <iframe>, javascript: hrefs, inline
 *    event handlers, etc.).
 *  - External links are forced to target="_blank" rel="noopener noreferrer".
 *  - Raw HTML in the markdown source is NOT rendered (rehype-raw is absent).
 *
 * Treat all `content` as untrusted (it comes from LLMs / remote agents).
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { Components } from "react-markdown";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  /** Raw markdown string from an agent / user message. */
  content: string;
  /**
   * When true, applies styling appropriate for user-bubble (brand-bg bg).
   * When false (default), applies agent-bubble styling (surface-soft bg).
   */
  isUser?: boolean;
}

// ---------------------------------------------------------------------------
// Component factory — called once per render, memoized implicitly by React
// ---------------------------------------------------------------------------

function makeComponents(isUser: boolean): Components {
  // ---- code ----------------------------------------------------------------
  // Inline code uses a faint tinted background.
  // Block code (inside <pre>) resets those inline styles; <pre> owns the bg.
  const inlineCodeCls = isUser
    ? "font-mono text-[0.85em] bg-white/30 px-1 py-0.5 rounded-sm [pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:rounded-none [pre_&]:text-[1em]"
    : "font-mono text-[0.85em] bg-surface-card border border-surface-border px-1 py-0.5 rounded-sm [pre_&]:bg-transparent [pre_&]:border-0 [pre_&]:p-0 [pre_&]:rounded-none [pre_&]:text-[1em]";

  const preBlockCls = isUser
    ? "font-mono text-xs bg-white/20 rounded-lg p-3 my-2 overflow-x-auto leading-relaxed"
    : "font-mono text-xs bg-surface-card border border-surface-border rounded-lg p-3 my-2 overflow-x-auto leading-relaxed";

  // ---- links ---------------------------------------------------------------
  const linkCls = isUser
    ? "underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity"
    : "text-brand underline underline-offset-2 hover:opacity-70 transition-opacity";

  return {
    // ---- Block elements ----------------------------------------------------
    p: ({ children }) => <p className="mb-2 last:mb-0 leading-snug">{children}</p>,

    h1: ({ children }) => (
      <h1 className="text-base font-bold mt-2 mb-1.5 first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1 first:mt-0">{children}</h2>,
    h3: ({ children }) => (
      <h3 className="text-sm font-semibold mt-1.5 mb-1 first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-sm font-medium mt-1 mb-0.5 first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-xs font-semibold mt-1 mb-0.5 first:mt-0">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-xs font-medium mt-1 mb-0.5 first:mt-0">{children}</h6>
    ),

    ul: ({ children }) => (
      <ul className="list-disc list-inside mb-2 last:mb-0 space-y-0.5 pl-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside mb-2 last:mb-0 space-y-0.5 pl-1">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-snug">{children}</li>,

    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-current/30 pl-3 my-2 opacity-75">
        {children}
      </blockquote>
    ),

    hr: () => <hr className="border-current/20 my-3" />,

    // ---- Code --------------------------------------------------------------
    pre: ({ children }) => <pre className={preBlockCls}>{children}</pre>,

    code: ({ children, className }) => (
      <code className={[inlineCodeCls, className ?? ""].filter(Boolean).join(" ")}>{children}</code>
    ),

    // ---- Inline elements ---------------------------------------------------
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="line-through opacity-70">{children}</del>,

    // ---- Links — always safe external target ------------------------------
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkCls}>
        {children}
      </a>
    ),

    // ---- GFM tables --------------------------------------------------------
    table: ({ children }) => (
      <div className="overflow-x-auto my-2 rounded-lg border border-current/20">
        <table className="text-xs w-full border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="border-b border-current/20">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className="border-b border-current/10 last:border-0">{children}</tr>,
    th: ({ children }) => (
      <th className="text-left px-2.5 py-1.5 font-semibold opacity-80">{children}</th>
    ),
    td: ({ children }) => <td className="px-2.5 py-1.5">{children}</td>,

    // ---- GFM task-list checkboxes (read-only) ------------------------------
    input: ({ type, checked, disabled }) => (
      <input
        type={type}
        checked={checked}
        disabled={disabled}
        readOnly
        className="mr-1 accent-brand cursor-default"
      />
    ),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MarkdownContent = ({ content, isUser = false }: Props) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeSanitize]}
    components={makeComponents(isUser)}
  >
    {content}
  </ReactMarkdown>
);
