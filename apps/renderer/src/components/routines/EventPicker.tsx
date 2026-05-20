import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { EventSpec, RoutineEventType } from "@prospero/shared";

type Props = {
  value: EventSpec;
  onChange: (s: EventSpec) => void;
};

const EVENT_TYPES: RoutineEventType[] = [
  "goal_achieved",
  "verification_failed",
  "issue_done",
  "agent_recovered",
];

export const EventPicker: FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div>
      <label className="block text-xs font-semibold text-ink mb-1">
        {t("routines.form.event")}
      </label>
      <select
        value={value.eventType}
        onChange={(e) => onChange({ eventType: e.target.value as RoutineEventType })}
        className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card w-full max-w-xs"
      >
        {EVENT_TYPES.map((et) => (
          <option key={et} value={et}>
            {t(`routines.form.events.${et}`)}
          </option>
        ))}
      </select>
    </div>
  );
};
