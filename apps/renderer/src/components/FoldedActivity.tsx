import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { GearSix, CaretRight, CaretDown } from "@phosphor-icons/react";
import type { ToolCallView } from "@prospero/shared";
import { ToolCallCard } from "./ToolCallCard.js";

// Folds an agent turn's tool calls into a collapsed "N ações" chip so the
// conversation reads as a conversation; expand to see the raw commands.
export const FoldedActivity: FC<{ tools: ToolCallView[] }> = ({ tools }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] font-mono text-ink-muted bg-surface-soft border border-surface-border rounded-lg px-2.5 py-1.5 hover:text-ink"
      >
        <GearSix size={13} aria-hidden={true} />
        {t("message.toolActions", { count: tools.length })}
        {open ? (
          <CaretDown size={11} aria-hidden={true} />
        ) : (
          <CaretRight size={11} aria-hidden={true} />
        )}
      </button>
      {open && (
        <div className="mt-1">
          {tools.map((tc) => (
            <ToolCallCard key={tc.id} tool={tc} />
          ))}
        </div>
      )}
    </div>
  );
};
