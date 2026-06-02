import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { riskInfo, type RiskKind } from "../../lib/risk.js";

export const RiskPill: FC<{ kind: RiskKind }> = ({ kind }) => {
  const { t } = useTranslation();
  const info = riskInfo(kind);
  return (
    <span
      className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${info.classes}`}
    >
      {t(info.labelKey)}
    </span>
  );
};
