import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

export const RichComposer: FC<Props> = ({ onSubmit, disabled = false }) => {
  const { t } = useTranslation();
  const [showFormat, setShowFormat] = useState(true);
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "",
    editorProps: {
      attributes: {
        class: "outline-none min-h-[24px] text-sm text-ink",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submit();
          return true;
        }
        return false;
      },
    },
  });

  const submit = (): void => {
    if (editor === null) return;
    // tiptap-markdown attaches `markdown.getMarkdown()` to `editor.storage` at
    // runtime but does not extend the `Storage` interface — narrow it here.
    const storage = editor.storage as unknown as {
      markdown: { getMarkdown: () => string };
    };
    const md = storage.markdown.getMarkdown().trim();
    if (md === "") return;
    onSubmit(md);
    editor.commands.clearContent();
  };

  const isEmpty = editor?.isEmpty ?? true;

  return (
    <div className="border-t border-surface-border bg-surface px-6 py-4">
      <div className="border border-surface-border rounded-lg bg-surface-soft">
        {showFormat && editor !== null && (
          <div className="flex items-center gap-1 px-3 py-2 border-b border-surface-border">
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} label="B" bold />
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleItalic().run()}
              label="I"
              italic
            />
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              label="U"
              underline
            />
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleStrike().run()}
              label="S"
              strike
            />
            <span className="text-ink-soft mx-1">|</span>
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} label="≡" />
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              label="1."
            />
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleCode().run()}
              label="</>"
              mono
            />
            <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} label="❝" />
          </div>
        )}
        <div className="px-3 py-3">
          <EditorContent editor={editor} />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-t border-surface-border">
          <button
            type="button"
            onClick={() => setShowFormat((s) => !s)}
            className="text-ink-muted hover:text-ink text-sm underline"
            title={t("agent.composer.toggleFormat")}
          >
            Aa
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={submit}
            disabled={disabled || isEmpty}
            className="bg-brand text-brand-fg px-3 py-1.5 rounded text-sm font-semibold disabled:opacity-40"
          >
            {t("agent.send")}
          </button>
        </div>
      </div>
    </div>
  );
};

const ToolbarBtn: FC<{
  onClick: () => void;
  label: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  mono?: boolean;
}> = ({ onClick, label, bold, italic, underline, strike, mono }) => {
  const cls = [
    "px-2 py-1 text-sm text-ink hover:bg-surface-card rounded",
    bold && "font-bold",
    italic && "italic",
    underline && "underline",
    strike && "line-through",
    mono && "font-mono",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" onClick={onClick} className={cls}>
      {label}
    </button>
  );
};
