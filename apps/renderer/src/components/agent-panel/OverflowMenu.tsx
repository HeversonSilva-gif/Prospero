import { useEffect, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  onCopyId: () => void;
  onResetSession: () => void;
  onTerminate: () => void;
}

export const OverflowMenu: FC<Props> = ({ onCopyId, onResetSession, onTerminate }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm px-2 py-1 text-ink-muted hover:text-ink"
        aria-label="menu"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-surface-card border border-surface-border rounded shadow-lg z-40 w-44">
          <button
            type="button"
            onClick={() => {
              onCopyId();
              setOpen(false);
            }}
            className="block w-full text-left text-xs px-3 py-1.5 hover:bg-surface-soft"
          >
            {t("agent.header.menu.copyId")}
          </button>
          <button
            type="button"
            onClick={() => {
              onResetSession();
              setOpen(false);
            }}
            className="block w-full text-left text-xs px-3 py-1.5 hover:bg-surface-soft"
          >
            {t("agent.header.menu.resetSession")}
          </button>
          <button
            type="button"
            onClick={() => {
              onTerminate();
              setOpen(false);
            }}
            className="block w-full text-left text-xs px-3 py-1.5 hover:bg-semantic-danger/10 text-semantic-danger border-t border-surface-border"
          >
            {t("agent.header.menu.terminate")}
          </button>
        </div>
      )}
    </div>
  );
};
