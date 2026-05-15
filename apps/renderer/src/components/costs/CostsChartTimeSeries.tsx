// Stacked area: input + output + cache_creation + cache_read tokens per day.
// recharts handles SVG rendering. We import named exports lazily — file lives
// inside the route chunk that's already lazy via React.lazy(Costs).

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import type { CostBucket } from "@prospero/shared";
import { formatTokens } from "../../lib/costs/formatCents.js";

type Props = { buckets: CostBucket[] };

const fmtDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const CostsChartTimeSeries: FC<Props> = ({ buckets }) => {
  const { t } = useTranslation();
  if (buckets.length === 0) {
    return <p className="text-xs text-ink-muted py-12 text-center">{t("costs.chart.noData")}</p>;
  }
  const data = buckets.map((b) => ({
    day: fmtDate(b.bucketStart),
    input: b.inputTokens,
    output: b.outputTokens,
    cacheCreate: b.cacheCreationTokens,
    cacheRead: b.cacheReadTokens,
  }));
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">{t("costs.chart.timeSeries")}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-border)" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v: number) => formatTokens(v)} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v) => formatTokens(typeof v === "number" ? v : 0)}
            contentStyle={{ fontSize: 12, background: "var(--surface)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="input"
            name={t("costs.chart.legend.input")}
            stackId="1"
            stroke="#1D5DD7"
            fill="#1D5DD7"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="output"
            name={t("costs.chart.legend.output")}
            stackId="1"
            stroke="#16a34a"
            fill="#16a34a"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="cacheCreate"
            name={t("costs.chart.legend.cacheCreate")}
            stackId="1"
            stroke="#FFC520"
            fill="#FFC520"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="cacheRead"
            name={t("costs.chart.legend.cacheRead")}
            stackId="1"
            stroke="#7c3aed"
            fill="#7c3aed"
            fillOpacity={0.4}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
