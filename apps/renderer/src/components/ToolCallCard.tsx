import type { ToolCallView } from "@prospero/shared";

export const ToolCallCard = ({ tool }: { tool: ToolCallView }) => {
  const inputJson = JSON.stringify(tool.input, null, 2);
  return (
    <div className="bg-surface-soft border border-surface-border border-l-2 border-l-brand rounded-md p-3 mt-2 font-mono text-xs">
      <div className="font-sans text-[11px] font-semibold text-brand uppercase tracking-wide mb-1.5">
        ⚙ tool: {tool.name}
        {tool.status === "pending" && <span className="ml-2 text-ink-soft">running…</span>}
      </div>
      <pre className="text-ink-muted whitespace-pre-wrap break-words">{inputJson}</pre>
      {tool.result !== null && (
        <div className="mt-2 pt-2 border-t border-surface-border text-ink">
          <div className="font-sans text-[10px] uppercase text-ink-soft mb-1">result</div>
          <pre className="whitespace-pre-wrap break-words">{tool.result}</pre>
        </div>
      )}
    </div>
  );
};
