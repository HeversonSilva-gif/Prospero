import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { RoleTemplate } from "@dashboard-agent/shared";

type Props = {
  role: RoleTemplate & { agentCount: number };
  selected: boolean;
  onSelect: () => void;
};

export const RoleListItem: FC<Props> = ({ role, selected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded border-l-2 transition-colors ${
        selected
          ? "bg-brand-bg border-brand text-brand-dark"
          : "border-transparent hover:bg-surface-soft text-ink"
      }`}
    >
      <div className="flex items-center gap-2">
        {role.icon !== null && <span className="text-base">{role.icon}</span>}
        <span className="font-semibold text-sm">{role.name}</span>
      </div>
      <div className="text-[11px] text-ink-muted mt-0.5">
        {t("skills.agentsCount", { count: role.agentCount })}
      </div>
    </button>
  );
};
