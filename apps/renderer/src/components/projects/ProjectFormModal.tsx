import { useState, type FC, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@prospero/shared";

const COLORS = [
  "#1D5DD7",
  "#10b981",
  "#f59e0b",
  "#dc2626",
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
  "#64748b",
];

const ICONS = [
  "📁",
  "📦",
  "🚀",
  "🛠️",
  "🧪",
  "📊",
  "💡",
  "🎨",
  "🔧",
  "📝",
  "🔬",
  "🏗️",
  "🌐",
  "📱",
  "💼",
  "🎯",
  "⚙️",
  "🧭",
  "🗂️",
  "🧱",
];

type Props = {
  initial?: Project;
  onSubmit: (data: {
    name: string;
    path: string;
    color: string;
    icon: string | null;
  }) => Promise<void>;
  onClose: () => void;
};

export const ProjectFormModal: FC<Props> = ({ initial, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [path, setPath] = useState(initial?.path ?? "");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]!);
  const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
  const [busy, setBusy] = useState(false);

  const pickFolder = async () => {
    const picked = await window.prospero.settings.pickWorkspace();
    if (picked !== null) setPath(picked);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() === "" || path.trim() === "") return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), path: path.trim(), color, icon });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-surface-card rounded p-5 w-full max-w-sm shadow-xl">
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("projects.form.name")}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          className="w-full mb-3 px-2 py-1 border border-surface-border rounded text-sm"
        />
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("projects.form.path")}
        </label>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            className="flex-1 px-2 py-1 border border-surface-border rounded text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => void pickFolder()}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("projects.form.pickFolder")}
          </button>
        </div>
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("projects.form.icon")}
        </label>
        <div className="grid grid-cols-10 gap-1 mb-3">
          <button
            type="button"
            onClick={() => setIcon(null)}
            className={`w-7 h-7 rounded text-xs ${icon === null ? "bg-brand text-brand-fg" : "bg-surface-soft text-ink-muted"}`}
            title={t("projects.form.iconNone")}
          >
            —
          </button>
          {ICONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setIcon(emoji)}
              className={`w-7 h-7 rounded text-base ${icon === emoji ? "bg-brand-bg ring-2 ring-brand" : "bg-surface-soft hover:bg-surface-border"}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <label className="block text-xs uppercase text-ink-soft mb-1">
          {t("projects.form.color")}
        </label>
        <div className="flex gap-2 mb-4">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{ background: c }}
              className={`w-6 h-6 rounded-full border-2 ${color === c ? "border-ink-muted" : "border-transparent"}`}
            />
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("projects.form.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="text-xs px-3 py-1 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
          >
            {t("projects.form.save")}
          </button>
        </div>
      </form>
    </div>
  );
};
