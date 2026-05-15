import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

// Custom frameless titlebar. The whole bar is a drag region except the
// buttons (each opts out with WebkitAppRegion: "no-drag"). Maximize button
// swaps its glyph based on the window state broadcast over IPC.

export const TitleBar: FC = () => {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void window.prospero.windowControls.isMaximized().then(setIsMaximized);
    const off = window.prospero.windowControls.onStateChanged((s) => {
      setIsMaximized(s.isMaximized);
    });
    return off;
  }, []);

  return (
    <div className="drag-region h-8 flex items-center justify-between bg-surface border-b border-surface-border select-none text-xs">
      <div className="px-3 flex items-center gap-2 text-ink-muted">
        <span className="w-2 h-2 rounded-full bg-brand" />
        <span className="font-semibold tracking-tight">{t("app.title")}</span>
      </div>
      <div className="no-drag-region flex items-center h-full">
        <button
          type="button"
          aria-label="minimize"
          onClick={() => void window.prospero.windowControls.minimize()}
          className="h-full w-11 flex items-center justify-center text-ink-muted hover:bg-surface-soft hover:text-ink"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="maximize"
          onClick={() => void window.prospero.windowControls.maximizeToggle()}
          className="h-full w-11 flex items-center justify-center text-ink-muted hover:bg-surface-soft hover:text-ink"
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect
                x="2"
                y="0.5"
                width="7"
                height="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
              <rect
                x="0.5"
                y="2"
                width="7"
                height="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          aria-label="close"
          onClick={() => void window.prospero.windowControls.close()}
          className="h-full w-11 flex items-center justify-center text-ink-muted hover:bg-semantic-danger hover:text-white"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
            <line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
};
