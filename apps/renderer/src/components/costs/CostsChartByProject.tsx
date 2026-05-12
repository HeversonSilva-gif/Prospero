// Donut chart — token distribution per project. Null projectId becomes
// "Sem projeto" / "No project".

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import type { CostProjectTotal } from "@dashboard-agent/shared";
import { formatTokens } from "../../lib/costs/formatCents.js";

type Props = { rows: CostProjectTotal[] };

const COLORS = ["#1D5DD7", "#16a34a", "#FFC520", "#7c3aed", "#5bc4e7", "#e83e1a"];

export const CostsChartByProject: FC<Props> = ({ rows }) => {
  const { t } = useTranslation();
  const visible = rows.filter((r) => r.tokens > 0);
  if (visible.length === 0) return null;
  const data = visible.map((r) => ({
    name: r.projectName ?? t("costs.filters.adapterAll"),
    value: r.tokens,
  }));
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">{t("costs.chart.byProject")}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={90}
            cx="50%"
            cy="50%"
          >
            {data.map((_, i) => (
              <Cell key={String(i)} fill={COLORS[i % COLORS.length] ?? "#1D5DD7"} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => formatTokens(typeof v === "number" ? v : 0)}
            contentStyle={{ fontSize: 12, background: "var(--surface)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};
