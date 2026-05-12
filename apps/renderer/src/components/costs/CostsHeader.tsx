// Sticky header: total today + %Max progress bar + total in range.

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { CostsAggregateTodayResult, CostsQueryResult } from "@dashboard-agent/shared";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = {
  today: CostsAggregateTodayResult;
  rangeTotals: CostsQueryResult["total"];
};

export const CostsHeader: FC<Props> = ({ today, rangeTotals }) => {
  const { t } = useTranslation();
  const pct = Math.min(today.percentMax, 100);
  const over = today.percentMax > 100;
  return (
    <header className="bg-surface-card border border-surface-border rounded-lg p-5 mb-6">
      <div className="flex flex-wrap items-baseline gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">
            {t("costs.header.totalToday")}
          </div>
          <div className="text-2xl font-bold text-brand-dark mt-0.5">
            {formatCents(today.totalCents)}
          </div>
          <div className="text-xs text-ink-muted">
            {formatTokens(today.totalTokens)} {t("dashboard.costsToday.tokens")}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold">
            {t("costs.header.totalRange")}
          </div>
          <div className="text-lg font-semibold text-ink mt-0.5">
            {formatCents(rangeTotals.cents)}
          </div>
          <div className="text-xs text-ink-muted">
            {formatTokens(rangeTotals.tokens)} {t("dashboard.costsToday.tokens")}
          </div>
        </div>
        <div className="flex-1 min-w-[180px]">
          <div className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold mb-1">
            {t("costs.header.percentMax")} — {String(today.percentMax)}%
          </div>
          <div className="h-2 bg-surface-soft rounded overflow-hidden">
            <div
              className={over ? "h-full bg-semantic-danger" : "h-full bg-brand"}
              style={{ width: `${String(pct)}%` }}
            />
          </div>
          {over && (
            <div className="text-[11px] text-semantic-danger mt-1 font-semibold">
              {t("costs.header.percentMaxOver")}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
