import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { QuietHoursSchedule, QuietWindow } from "@prospero/shared";

type Props = {
  value: QuietHoursSchedule;
  onChange: (next: QuietHoursSchedule) => void;
};

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const minutesToTime = (m: number): string => {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
};

const timeToMinutes = (s: string): number => {
  const [h, m] = s.split(":").map((x) => Number.parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
};

export const QuietHoursEditor: FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();

  const updateWindow = (idx: number, patch: Partial<QuietWindow>): void => {
    const next = value.windows.map((w, i) => (i === idx ? { ...w, ...patch } : w));
    onChange({ windows: next });
  };

  const removeWindow = (idx: number): void => {
    onChange({ windows: value.windows.filter((_, i) => i !== idx) });
  };

  const addWindow = (): void => {
    onChange({
      windows: [
        ...value.windows,
        { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 22 * 60, endMinute: 8 * 60 },
      ],
    });
  };

  const toggleDay = (idx: number, day: number): void => {
    const w = value.windows[idx];
    if (w === undefined) return;
    const next = w.daysOfWeek.includes(day)
      ? w.daysOfWeek.filter((d) => d !== day)
      : [...w.daysOfWeek, day].sort();
    updateWindow(idx, { daysOfWeek: next });
  };

  return (
    <div className="space-y-3">
      {value.windows.map((w, idx) => {
        const invalid = w.startMinute === w.endMinute;
        return (
          <div
            key={idx}
            className="bg-surface-card border border-surface-border rounded p-3 space-y-2"
          >
            <div className="flex flex-wrap gap-1">
              {DAY_KEYS.map((k, i) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleDay(idx, i)}
                  className={`text-xs px-2 py-1 rounded ${
                    w.daysOfWeek.includes(i)
                      ? "bg-brand text-white"
                      : "bg-surface-soft text-ink-muted"
                  }`}
                >
                  {t(`settings.governance.day.${k}`)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label>{t("settings.governance.from")}</label>
              <input
                type="time"
                value={minutesToTime(w.startMinute)}
                onChange={(e) => updateWindow(idx, { startMinute: timeToMinutes(e.target.value) })}
                className="bg-surface-soft border border-surface-border rounded px-2 py-1"
              />
              <label>{t("settings.governance.to")}</label>
              <input
                type="time"
                value={minutesToTime(w.endMinute)}
                onChange={(e) => updateWindow(idx, { endMinute: timeToMinutes(e.target.value) })}
                className="bg-surface-soft border border-surface-border rounded px-2 py-1"
              />
              <button
                type="button"
                onClick={() => removeWindow(idx)}
                className="ml-auto text-xs text-semantic-danger hover:underline"
              >
                {t("settings.governance.removeWindow")}
              </button>
            </div>
            {invalid && (
              <p className="text-xs text-semantic-danger">
                {t("settings.governance.errorEmptyWindow")}
              </p>
            )}
          </div>
        );
      })}
      <button type="button" onClick={addWindow} className="text-xs text-brand hover:underline">
        + {t("settings.governance.addWindow")}
      </button>
    </div>
  );
};
