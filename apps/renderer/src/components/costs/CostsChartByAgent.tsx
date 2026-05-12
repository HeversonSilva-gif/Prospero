// Horizontal bar chart — top 10 agents by total tokens in range.

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { CostAgentTotal } from "@dashboard-agent/shared";
import { formatTokens } from "../../lib/costs/formatCents.js";

type Props = { rows: CostAgentTotal[] };

export const CostsChartByAgent: FC<Props> = ({ rows }) => {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return null;
  }
  const data = rows.map((r) => ({
    name: r.agentName,
    tokens: r.tokens,
    cents: r.cents,
  }));
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">{t("costs.chart.byAgent")}</h3>
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-border)" />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatTokens(v)}
            tick={{ fontSize: 11 }}
          />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
          <Tooltip
            formatter={(v) => formatTokens(typeof v === "number" ? v : 0)}
            contentStyle={{ fontSize: 12, background: "var(--surface)" }}
          />
          <Bar dataKey="tokens" fill="#1D5DD7" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
