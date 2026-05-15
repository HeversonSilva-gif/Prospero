// Polls + subscribes to costs:aggregate-today for the Dashboard widget.
// Re-fetches on every costs-new broadcast (debounced 1s by main) so the
// widget stays fresh without polling.

import { useCallback, useEffect, useState } from "react";
import type { CostsAggregateTodayResult } from "@prospero/shared";

const empty: CostsAggregateTodayResult = {
  totalCents: 0,
  totalTokens: 0,
  percentMax: 0,
  byAgent: [],
};

export const useCostsToday = (
  companyId: string | null,
): { data: CostsAggregateTodayResult; loading: boolean; refresh: () => Promise<void> } => {
  const [data, setData] = useState<CostsAggregateTodayResult>(empty);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (companyId === null) return;
    setLoading(true);
    try {
      const r = await window.prospero.costs.aggregateToday({ companyId });
      setData(r);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (companyId === null) return;
    const off = window.prospero.costs.onNew(() => {
      void refresh();
    });
    return off;
  }, [companyId, refresh]);

  return { data, loading, refresh };
};
