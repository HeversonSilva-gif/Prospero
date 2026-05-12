// Lightweight widget for the Dashboard route. Subscribes to costs-new
// broadcasts so the number updates live without polling.

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCostsToday } from "../../hooks/useCostsToday.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = { companyId: string | null };

export const CostsTodayWidget: FC<Props> = ({ companyId }) => {
  const { t } = useTranslation();
  const { data } = useCostsToday(companyId);
  const over = data.percentMax > 100;
  const pct = Math.min(data.percentMax, 100);

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5 max-w-md">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">{t("dashboard.costsToday.title")}</h3>
        <Link to="/costs" className="text-xs text-brand hover:underline">
          {t("dashboard.costsToday.viewDetails")}
        </Link>
      </div>
      {data.totalTokens === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.costsToday.noActivity")}</p>
      ) : (
        <>
          <div className="text-3xl font-bold text-brand-dark">{formatCents(data.totalCents)}</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {formatTokens(data.totalTokens)} {t("dashboard.costsToday.tokens")}
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold mb-1">
              {t("costs.header.percentMax")} — {String(data.percentMax)}%
            </div>
            <div className="h-1.5 bg-surface-soft rounded overflow-hidden">
              <div
                className={over ? "h-full bg-semantic-danger" : "h-full bg-brand"}
                style={{ width: `${String(pct)}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
