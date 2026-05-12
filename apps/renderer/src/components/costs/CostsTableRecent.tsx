// Table of agents x tokens x cents (top by tokens in range). The query
// already returns this as byAgent in CostsQueryResult; we just render.
// Per-turn detail is out of scope v1 — would require new IPC for raw rows.

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { CostAgentTotal } from "@dashboard-agent/shared";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = { rows: CostAgentTotal[] };

export const CostsTableRecent: FC<Props> = ({ rows }) => {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <p className="text-xs text-ink-muted py-6 text-center">{t("costs.table.empty")}</p>;
  }
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg overflow-hidden">
      <h3 className="text-sm font-semibold text-brand-dark p-4 pb-2">{t("costs.table.title")}</h3>
      <table className="w-full text-sm">
        <thead className="bg-surface-soft text-[10px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-left px-4 py-2 font-semibold">{t("costs.table.agent")}</th>
            <th className="text-right px-4 py-2 font-semibold">{t("costs.table.tokens")}</th>
            <th className="text-right px-4 py-2 font-semibold">{t("costs.table.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agentId} className="border-t border-surface-border">
              <td className="px-4 py-2 text-ink">{r.agentName}</td>
              <td className="px-4 py-2 text-right text-ink-muted tabular-nums">
                {formatTokens(r.tokens)}
              </td>
              <td className="px-4 py-2 text-right text-ink font-semibold tabular-nums">
                {formatCents(r.cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
