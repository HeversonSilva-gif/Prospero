import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduleSpec } from "@prospero/shared";
import { TabBar } from "../ui/TabBar.js";
import { formatAtMinute, parseAtMinute } from "../../lib/routines/format-summary.js";

type Freq = "daily" | "weekly" | "monthly" | "interval";

type Props = {
  value: ScheduleSpec;
  onChange: (s: ScheduleSpec) => void;
};

const defaultForFreq = (freq: Freq): ScheduleSpec => {
  if (freq === "daily") return { freq: "daily", atMinute: 540 };
  if (freq === "weekly") return { freq: "weekly", weekday: 1, atMinute: 540 };
  if (freq === "monthly") return { freq: "monthly", day: 1, atMinute: 540 };
  return { freq: "interval", everyMinutes: 30 };
};

export const RecurrencePicker: FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [activeFreq, setActiveFreq] = useState<Freq>(value.freq);

  const handleTab = (next: Freq): void => {
    setActiveFreq(next);
    onChange(defaultForFreq(next));
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-ink">
        {t("routines.form.recurrence")}
      </label>
      <TabBar
        tabs={[
          { id: "daily", label: t("routines.form.freq.daily") },
          { id: "weekly", label: t("routines.form.freq.weekly") },
          { id: "monthly", label: t("routines.form.freq.monthly") },
          { id: "interval", label: t("routines.form.freq.interval") },
        ]}
        active={activeFreq}
        onSelect={(id) => handleTab(id as Freq)}
        variant="segmented"
      />
      <div className="pt-1">
        {value.freq === "daily" && (
          <div>
            <label className="block text-xs text-ink-muted mb-1">
              {t("routines.form.atMinute")}
            </label>
            <input
              type="time"
              value={formatAtMinute(value.atMinute)}
              onChange={(e) => onChange({ freq: "daily", atMinute: parseAtMinute(e.target.value) })}
              className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card"
            />
          </div>
        )}

        {value.freq === "weekly" && (
          <div className="flex gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {t("routines.form.weekday")}
              </label>
              <select
                value={value.weekday}
                onChange={(e) =>
                  onChange({
                    freq: "weekly",
                    weekday: Number(e.target.value),
                    atMinute: value.atMinute,
                  })
                }
                className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card"
              >
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {t(`routines.weekday.${String(d)}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {t("routines.form.atMinute")}
              </label>
              <input
                type="time"
                value={formatAtMinute(value.atMinute)}
                onChange={(e) =>
                  onChange({
                    freq: "weekly",
                    weekday: value.weekday,
                    atMinute: parseAtMinute(e.target.value),
                  })
                }
                className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card"
              />
            </div>
          </div>
        )}

        {value.freq === "monthly" && (
          <div className="flex gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {t("routines.form.monthDay")}
              </label>
              <input
                type="number"
                min={1}
                max={28}
                value={value.day}
                onChange={(e) =>
                  onChange({
                    freq: "monthly",
                    day: Math.max(1, Math.min(28, Number(e.target.value) || 1)),
                    atMinute: value.atMinute,
                  })
                }
                className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card w-20"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                {t("routines.form.atMinute")}
              </label>
              <input
                type="time"
                value={formatAtMinute(value.atMinute)}
                onChange={(e) =>
                  onChange({
                    freq: "monthly",
                    day: value.day,
                    atMinute: parseAtMinute(e.target.value),
                  })
                }
                className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card"
              />
            </div>
          </div>
        )}

        {value.freq === "interval" && (
          <div>
            <label className="block text-xs text-ink-muted mb-1">
              {t("routines.form.everyMinutes")}
            </label>
            <input
              type="number"
              min={1}
              value={value.everyMinutes}
              onChange={(e) =>
                onChange({
                  freq: "interval",
                  everyMinutes: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card w-24"
            />
          </div>
        )}
      </div>
    </div>
  );
};
