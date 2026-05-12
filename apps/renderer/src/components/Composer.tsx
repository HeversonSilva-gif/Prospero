import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

export const Composer = ({ onSubmit, disabled = false }: Props) => {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    onSubmit(trimmed);
    setValue("");
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(value);
    }
  };

  return (
    <form onSubmit={onFormSubmit} className="border-t border-surface-border px-6 py-4 bg-surface">
      <div className="flex gap-2 items-end bg-surface-soft border border-surface-border rounded-lg px-3 py-2.5">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("agent.composerPlaceholder")}
          rows={1}
          disabled={disabled}
          className="flex-1 bg-transparent border-0 outline-none resize-none text-sm leading-snug text-ink min-h-[22px]"
        />
        <button
          type="submit"
          disabled={disabled || value.trim() === ""}
          className="bg-brand text-brand-fg border-0 px-3.5 py-2 rounded-md font-semibold text-xs disabled:opacity-50"
        >
          {t("agent.send")}
        </button>
      </div>
    </form>
  );
};
