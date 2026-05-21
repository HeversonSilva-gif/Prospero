import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { ActivityEventRow, ActivityQueryFilters } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";
import {
  ActivityFilters,
  whenKeyToSinceMs,
  type WhenKey,
} from "../components/activity/ActivityFilters.js";
import { ActivityRow } from "../components/activity/ActivityRow.js";
import { useActivityStream } from "../hooks/useActivityStream.js";
import type { Lookups } from "../components/activity/activityRender.js";

export const matchesSearch = (row: ActivityEventRow, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const haystack = `${row.action} ${JSON.stringify(row.payload)}`.toLowerCase();
  return haystack.includes(q);
};

export const Activity: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useActiveCompanyId();
  const agents = useAgentsStore((s) => s.agents);

  const [baseFilters, setBaseFilters] = useState<ActivityQueryFilters>({});
  const [whenKey, setWhenKey] = useState<WhenKey>("all");
  const [search, setSearch] = useState("");

  const filters = useMemo<ActivityQueryFilters>(() => {
    const sinceMs = whenKeyToSinceMs(whenKey, Date.now());
    return sinceMs === undefined ? baseFilters : { ...baseFilters, sinceMs };
  }, [baseFilters, whenKey]);

  const { rows, loading, hasMore, loadMore } = useActivityStream(companyId ?? "", filters);

  const seenRef = useRef<Set<string>>(new Set());

  const lookups = useMemo<Lookups>(
    () => ({
      agentsById: new Map(agents.map((a) => [a.id, a.name])),
      currentUserName: t("activity.you"),
      systemName: t("activity.system"),
    }),
    [agents, t],
  );

  const visible = useMemo(() => {
    if (search.trim() === "") return rows;
    return rows.filter((r) => matchesSearch(r, search));
  }, [rows, search]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (el === null) return;
    if (!hasMore || loading) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void loadMore();
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, loadMore]);

  const handleNavigate = (row: ActivityEventRow): void => {
    if (row.entityKind === "agent") navigate(`/agents/${row.entityId}`);
    else if (row.entityKind === "issue") navigate("/issues");
    else if (row.entityKind === "project") navigate("/projects");
    else if (row.entityKind === "approval") navigate("/inbox");
  };

  const handleClear = (): void => {
    setBaseFilters({});
    setWhenKey("all");
    setSearch("");
  };

  if (companyId === null) {
    return (
      <div className="p-8">
        <p className="text-ink-muted text-sm">{t("activity.empty")}</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-1">{t("activity.title")}</h1>
      <p className="text-sm text-ink-muted mb-4">{t("activity.subtitle")}</p>

      <ActivityFilters
        filters={baseFilters}
        whenKey={whenKey}
        search={search}
        agents={agents}
        onChange={setBaseFilters}
        onWhenChange={setWhenKey}
        onSearchChange={setSearch}
        onClear={handleClear}
      />

      {visible.length === 0 && !loading ? (
        <p className="text-ink-muted text-sm">{t("activity.empty")}</p>
      ) : (
        <ul className="bg-surface-card rounded border border-surface-border">
          {visible.map((row) => {
            const isNew = !seenRef.current.has(row.id);
            seenRef.current.add(row.id);
            return (
              <ActivityRow
                key={row.id}
                row={row}
                lookups={lookups}
                isNew={isNew}
                onNavigate={handleNavigate}
              />
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="py-4 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="text-xs text-ink-muted hover:text-brand underline disabled:opacity-50"
          >
            {t("activity.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
};
