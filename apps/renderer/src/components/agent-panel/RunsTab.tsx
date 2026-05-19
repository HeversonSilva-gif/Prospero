import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { AgentRunRow, ActivityEventRow } from "@prospero/shared";
import { groupRunsBySession } from "../../lib/runs/groupRunsBySession.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";
import { Section, EmptyState, LoadingState } from "../ui/index.js";

type Props = { agentId: string; companyId: string };

const runTokens = (r: AgentRunRow): number =>
  r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens;

// ── Stat pill — one labelled metric in the full-width drill-in row ──────────
const StatPill: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5 rounded-md bg-surface-soft px-3 py-2 min-w-0">
    <span className="text-[9px] uppercase tracking-wide text-ink-soft font-semibold truncate">
      {label}
    </span>
    <span className="text-xs tabular-nums font-medium text-ink truncate">{value}</span>
  </div>
);

export const RunsTab: FC<Props> = ({ agentId, companyId }) => {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEventRow[]>([]);

  // Guards the async activity fetch in `toggle` — a slow query for a run the
  // user already collapsed (or swapped away from) must not overwrite state.
  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await window.prospero.runs.list(agentId);
      if (!cancelled) {
        setRuns(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // occurred_at of the turn immediately before each run — the lower bound of
  // the run's activity window. runs is sorted newest-first, so the previous
  // turn of runs[i] is runs[i + 1]; the first-ever run gets 0.
  const prevByRunId = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < runs.length; i++) {
      m.set(runs[i]!.id, runs[i + 1]?.occurredAt ?? 0);
    }
    return m;
  }, [runs]);

  const sessions = useMemo(() => groupRunsBySession(runs), [runs]);

  const toggle = (run: AgentRunRow): void => {
    if (expandedId === run.id) {
      activeRunIdRef.current = null;
      setExpandedId(null);
      setActivity([]);
      return;
    }
    activeRunIdRef.current = run.id;
    setExpandedId(run.id);
    setActivity([]);
    const fromExclusive = (prevByRunId.get(run.id) ?? 0) + 1;
    void (async () => {
      const rows = await window.prospero.activity.query({
        companyId,
        filters: { agentId, sinceMs: fromExclusive, untilMs: run.occurredAt },
        limit: 200,
      });
      if (activeRunIdRef.current === run.id) setActivity(rows);
    })();
  };

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="p-6">
        <EmptyState message={t("agent.runs.empty")} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {sessions.map((session, si) => (
        <Section
          key={session.sessionId ?? `null-${String(si)}`}
          title={t("agent.runs.session", { n: si + 1 })}
        >
          {/* Run list — compact header rows, one per turn */}
          <ul className="divide-y divide-surface-border rounded-md border border-surface-border overflow-hidden">
            {session.runs.map((run) => (
              <li key={run.id}>
                {/* ── Collapsed header row ─────────────────────────────── */}
                <button
                  type="button"
                  onClick={() => toggle(run)}
                  className="w-full text-left px-4 py-2.5 flex items-center gap-3 text-xs bg-surface hover:bg-surface-soft transition-colors"
                >
                  {/* Expand chevron */}
                  <span
                    className={`text-[9px] text-ink-soft transition-transform duration-150 ${
                      expandedId === run.id ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>

                  {/* Time */}
                  <span className="text-ink-muted tabular-nums shrink-0">
                    {new Date(run.occurredAt).toLocaleTimeString()}
                  </span>

                  {/* Model — grows to fill */}
                  <span className="text-ink font-medium truncate flex-1">{run.model ?? "—"}</span>

                  {/* Token total */}
                  <span className="text-ink-soft tabular-nums shrink-0">
                    {formatTokens(runTokens(run))}
                    <span className="text-[9px] ml-0.5 text-ink-soft opacity-60">
                      {t("agent.studio.runs.tok")}
                    </span>
                  </span>

                  {/* Cost */}
                  <span className="tabular-nums shrink-0 font-medium text-brand-dark">
                    {formatCents(run.costCentsEstimate)}
                  </span>
                </button>

                {/* ── Expanded drill-in — full width ───────────────────── */}
                {expandedId === run.id && (
                  <div className="border-t border-surface-border bg-surface-soft/40 px-4 py-4 space-y-4">
                    {/* Stats row — horizontally tiled pill cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      <StatPill
                        label={t("agent.runs.tokensIn")}
                        value={formatTokens(run.inputTokens)}
                      />
                      <StatPill
                        label={t("agent.runs.tokensOut")}
                        value={formatTokens(run.outputTokens)}
                      />
                      <StatPill
                        label={t("agent.runs.tokensCache")}
                        value={formatTokens(run.cacheCreationTokens + run.cacheReadTokens)}
                      />
                      <StatPill
                        label={t("agent.studio.runs.cost")}
                        value={formatCents(run.costCentsEstimate)}
                      />
                      <StatPill label={t("agent.studio.runs.model")} value={run.model ?? "—"} />
                      <StatPill label={t("agent.runs.adapter")} value={run.adapterName} />
                    </div>

                    {/* Activity section — left-rail timeline */}
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-ink-soft font-semibold mb-2">
                        {t("agent.runs.activity")}
                      </p>
                      {activity.length === 0 ? (
                        <p className="text-[11px] text-ink-muted">{t("agent.runs.noActivity")}</p>
                      ) : (
                        <ul className="border-l-2 border-surface-border pl-3 space-y-1">
                          {activity.map((ev) => (
                            <li key={ev.id} className="text-[11px] text-ink-soft">
                              {ev.action}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
};
