import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEventRow, ActivityQueryFilters } from "@prospero/shared";

const PAGE_SIZE = 50;

export const matchesFilters = (row: ActivityEventRow, filters: ActivityQueryFilters): boolean => {
  if (filters.actorKind !== undefined && row.actorKind !== filters.actorKind) return false;
  if (filters.action !== undefined && row.action !== filters.action) return false;
  if (filters.entityKind !== undefined && row.entityKind !== filters.entityKind) return false;
  if (filters.entityId !== undefined && row.entityId !== filters.entityId) return false;
  if (filters.agentId !== undefined && row.agentId !== filters.agentId) return false;
  if (filters.sinceMs !== undefined && row.createdAt < filters.sinceMs) return false;
  if (filters.untilMs !== undefined && row.createdAt > filters.untilMs) return false;
  return true;
};

export const mergeNew = (
  existing: ActivityEventRow[],
  incoming: ActivityEventRow,
): ActivityEventRow[] => {
  if (existing.some((r) => r.id === incoming.id)) return existing;
  return [incoming, ...existing];
};

export interface ActivityStream {
  rows: ActivityEventRow[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useActivityStream = (
  companyId: string,
  filters: ActivityQueryFilters,
): ActivityStream => {
  const [rows, setRows] = useState<ActivityEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  const fetchPage = useCallback(
    async (cursor?: { beforeCreatedAt: number; beforeId: string }) => {
      setLoading(true);
      try {
        const result = await window.prospero.activity.query({
          companyId,
          filters: filtersRef.current,
          limit: PAGE_SIZE,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        return result;
      } finally {
        setLoading(false);
      }
    },
    [companyId],
  );

  const refresh = useCallback(async () => {
    const fresh = await fetchPage();
    setRows(fresh);
    setHasMore(fresh.length >= PAGE_SIZE);
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    setRows((current) => current);
    const last = rows[rows.length - 1];
    if (last === undefined) return;
    const next = await fetchPage({ beforeCreatedAt: last.createdAt, beforeId: last.id });
    setRows((current) => {
      const seen = new Set(current.map((r) => r.id));
      const merged = [...current];
      for (const r of next) if (!seen.has(r.id)) merged.push(r);
      return merged;
    });
    setHasMore(next.length >= PAGE_SIZE);
  }, [fetchPage, rows]);

  useEffect(() => {
    void refresh();
  }, [companyId, filtersKey, refresh]);

  useEffect(() => {
    const off = window.prospero.activity.onNew((row) => {
      if (row.companyId !== companyId) return;
      if (!matchesFilters(row, filtersRef.current)) return;
      setRows((current) => mergeNew(current, row));
    });
    return off;
  }, [companyId]);

  return { rows, loading, hasMore, loadMore, refresh };
};
