// Wraps costs:query with derived state for /costs route. Pure-fn pieces
// (buildQueryRange, deriveAgentFilter) are exported for unit testing without
// React render.

import { useCallback, useEffect, useState } from "react";
import type { CostsQueryInput, CostsQueryResult, CostsQueryScope } from "@dashboard-agent/shared";

export type DateRange = "1d" | "7d" | "30d";

export type CostsQueryFilters = {
  range: DateRange;
  scope: CostsQueryScope;
  refId: string;
  adapterName: string;
};

export const buildQueryRange = (range: DateRange, nowMs: number): { from: number; to: number } => {
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  return { from: nowMs - days * 86_400_000, to: nowMs };
};

export const deriveAgentFilter = (
  scope: CostsQueryScope,
  refId: string,
): { scope: CostsQueryScope; refId?: string } => {
  if (refId === "") return { scope };
  return { scope, refId };
};

const empty: CostsQueryResult = {
  buckets: [],
  byAgent: [],
  byProject: [],
  total: { tokens: 0, cents: 0 },
};

export const useCostsQuery = (
  companyId: string | null,
  filters: CostsQueryFilters,
): { result: CostsQueryResult; loading: boolean; refresh: () => Promise<void> } => {
  const [result, setResult] = useState<CostsQueryResult>(empty);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (companyId === null) return;
    setLoading(true);
    try {
      const { from, to } = buildQueryRange(filters.range, Date.now());
      const agentFilter = deriveAgentFilter(filters.scope, filters.refId);
      const input: CostsQueryInput = {
        companyId,
        scope: agentFilter.scope,
        from,
        to,
        bucket: "day",
        ...(agentFilter.refId !== undefined ? { refId: agentFilter.refId } : {}),
        ...(filters.adapterName !== "" ? { adapterName: filters.adapterName } : {}),
      };
      const r = await window.dashboardAgent.costs.query(input);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }, [companyId, filters.range, filters.scope, filters.refId, filters.adapterName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { result, loading, refresh };
};
