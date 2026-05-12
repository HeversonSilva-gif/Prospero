import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  initialValue: string;
  onSave: (value: string) => void;
  onClose: () => void;
}

export const InstructionsFullScreenModal: FC<Props> = ({ initialValue, onSave, onClose }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-8">
      <div className="bg-surface-card rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col">
        <header className="px-5 py-3 border-b border-surface-border flex justify-between items-center">
          <h2 className="text-base font-semibold text-brand-dark">
            {t("agent.instructions.modalTitle")}
          </h2>
          <button type="button" onClick={onClose} className="text-xs text-ink-muted hover:text-ink">
            {t("agent.instructions.close")}
          </button>
        </header>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => onSave(value)}
          className="flex-1 p-5 text-sm font-mono resize-none border-none focus:outline-none bg-surface"
        />
        <p className="px-5 py-2 text-[10px] text-ink-soft border-t border-surface-border">
          {t("agent.instructions.applyNote")}
        </p>
      </div>
    </div>
  );
};
