import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallRef } from "@prospero/shared";

type Props = { history: ToolCallRef[] };

export const ToolCallHistoryAccordion: FC<Props> = ({ history }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (history.length === 0) return null;
  return (
    <div className="border-t border-surface-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] uppercase text-ink-soft font-semibold hover:text-brand"
      >
        {t("issues.detail.toolHistory")} ({history.length}) — {open ? "▼" : "▶"}{" "}
        {t("issues.detail.expand")}
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-xs font-mono">
          {history.map((c, idx) => (
            <div key={idx} className="bg-surface-soft px-2 py-1 rounded">
              <span className="text-brand">{c.toolName}</span>
              <span className="text-ink-muted"> {JSON.stringify(c.input).slice(0, 80)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
