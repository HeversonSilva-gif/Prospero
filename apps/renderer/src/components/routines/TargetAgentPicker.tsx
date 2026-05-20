import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { useAgentsStore } from "../../stores/agents.js";

type Props = {
  value: string | null;
  onChange: (id: string) => void;
};

export const TargetAgentPicker: FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents.filter((a) => a.status !== "terminated"));

  if (agents.length === 0) {
    return (
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">
          {t("routines.form.targetAgent")}
        </label>
        <p className="text-xs text-ink-muted">{t("routines.form.targetAgentEmpty")}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-ink mb-1">
        {t("routines.form.targetAgent")}
      </label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 text-sm rounded border border-surface-border bg-surface-card w-full max-w-md"
      >
        <option value="" disabled>
          {t("routines.form.targetAgentPlaceholder")}
        </option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.role})
          </option>
        ))}
      </select>
    </div>
  );
};
