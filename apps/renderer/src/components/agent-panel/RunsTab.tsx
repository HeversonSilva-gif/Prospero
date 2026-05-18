import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { AgentRunRow, ActivityEventRow } from "@prospero/shared";
import { groupRunsBySession } from "../../lib/runs/groupRunsBySession.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = { agentId: string; companyId: string };

const runTokens = (r: AgentRunRow): number =>
  r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens;

export const RunsTab: FC<Props> = ({ agentId, companyId }) => {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEventRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await window.prospero.runs.list(agentId);
      if (!cancelled) setRuns(rows);
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
      setExpandedId(null);
      setActivity([]);
      return;
    }
    setExpandedId(run.id);
    setActivity([]);
    const fromExclusive = (prevByRunId.get(run.id) ?? 0) + 1;
    void (async () => {
      const rows = await window.prospero.activity.query({
        companyId,
        filters: { agentId, sinceMs: fromExclusive, untilMs: run.occurredAt },
        limit: 200,
      });
      setActivity(rows);
    })();
  };

  if (runs.length === 0) {
    return <div className="p-4 text-xs text-ink-muted">{t("agent.runs.empty")}</div>;
  }

  return (
    <div className="p-3 space-y-3">
      {sessions.map((session, si) => (
        <section key={session.sessionId ?? `null-${String(si)}`}>
          <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-1">
            {t("agent.runs.session", { n: si + 1 })}
          </h3>
          <ul className="space-y-1">
            {session.runs.map((run) => (
              <li key={run.id} className="border border-surface-border rounded">
                <button
                  type="button"
                  onClick={() => toggle(run)}
                  className="w-full text-left px-2 py-1.5 flex items-center gap-2 text-xs"
                >
                  <span className="text-ink-muted tabular-nums">
                    {new Date(run.occurredAt).toLocaleTimeString()}
                  </span>
                  <span className="text-ink truncate flex-1">{run.model ?? "—"}</span>
                  <span className="text-ink-soft tabular-nums">{formatTokens(runTokens(run))}</span>
                  <span className="text-brand-dark tabular-nums">
                    {formatCents(run.costCentsEstimate)}
                  </span>
                </button>
                {expandedId === run.id && (
                  <div className="px-3 py-2 border-t border-surface-border space-y-2">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div className="flex justify-between">
                        <dt className="text-ink-soft">{t("agent.runs.tokensIn")}</dt>
                        <dd className="tabular-nums">{formatTokens(run.inputTokens)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-soft">{t("agent.runs.tokensOut")}</dt>
                        <dd className="tabular-nums">{formatTokens(run.outputTokens)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-soft">{t("agent.runs.tokensCache")}</dt>
                        <dd className="tabular-nums">
                          {formatTokens(run.cacheCreationTokens + run.cacheReadTokens)}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-soft">{t("agent.runs.adapter")}</dt>
                        <dd className="truncate">{run.adapterName}</dd>
                      </div>
                    </dl>
                    <div>
                      <div className="text-[10px] uppercase text-ink-soft font-semibold mb-1">
                        {t("agent.runs.activity")}
                      </div>
                      {activity.length === 0 ? (
                        <p className="text-[11px] text-ink-muted">{t("agent.runs.noActivity")}</p>
                      ) : (
                        <ul className="space-y-0.5">
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
        </section>
      ))}
    </div>
  );
};
