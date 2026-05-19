import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { AgentBudgetStatus, BudgetPeriod } from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { formatCents, formatTokens } from "../../lib/costs/formatCents.js";

type Props = { agentId: string };

const pct = (used: number, limit: number | null): number => {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
};

const Bar: FC<{ percent: number }> = ({ percent }) => {
  const color =
    percent >= 100 ? "bg-semantic-danger" : percent >= 80 ? "bg-semantic-warning" : "bg-brand";
  return (
    <div className="h-1.5 w-full rounded bg-surface-soft overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${String(percent)}%` }} />
    </div>
  );
};

export const BudgetSection: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const setBudget = useAgentsStore((s) => s.setBudget);
  const [status, setStatus] = useState<AgentBudgetStatus | null>(null);
  const [tokensInput, setTokensInput] = useState("");
  const [usdInput, setUsdInput] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("daily");
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const s = await window.prospero.costs.getAgentBudgetStatus(agentId);
    setStatus(s);
    setTokensInput(s.tokenLimit === null ? "" : String(s.tokenLimit));
    setUsdInput(s.usdLimitCents === null ? "" : String(s.usdLimitCents / 100));
    setPeriod(s.period);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await window.prospero.costs.getAgentBudgetStatus(agentId);
      if (cancelled) return;
      setStatus(s);
      setTokensInput(s.tokenLimit === null ? "" : String(s.tokenLimit));
      setUsdInput(s.usdLimitCents === null ? "" : String(s.usdLimitCents / 100));
      setPeriod(s.period);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const save = async (): Promise<void> => {
    setError(null);
    let tokensLimit: number | null = null;
    if (tokensInput.trim() !== "") {
      const n = Number(tokensInput);
      if (!Number.isInteger(n) || n <= 0) {
        setError(t("agent.stats.budget.invalid"));
        return;
      }
      tokensLimit = n;
    }
    let usdLimit: number | null = null;
    if (usdInput.trim() !== "") {
      const d = Number(usdInput);
      if (!Number.isFinite(d) || d <= 0) {
        setError(t("agent.stats.budget.invalid"));
        return;
      }
      usdLimit = Math.round(d * 100);
    }
    await setBudget(agentId, tokensLimit, usdLimit, period);
    await load();
  };

  if (status === null) return null;

  return (
    <div className="border-t border-surface-border pt-3">
      <div className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
        {t("agent.stats.budget.label")}
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <div className="flex justify-between text-[10px] text-ink-soft mb-1">
            <span>{t("agent.stats.budget.tokens")}</span>
            <span className="tabular-nums">
              {formatTokens(status.tokenTotal)}
              {status.tokenLimit !== null
                ? ` / ${formatTokens(status.tokenLimit)} (${String(pct(status.tokenTotal, status.tokenLimit))}%)`
                : ` / ${t("agent.stats.budget.unset")}`}
            </span>
          </div>
          <Bar percent={pct(status.tokenTotal, status.tokenLimit)} />
        </div>

        <div>
          <div className="flex justify-between text-[10px] text-ink-soft mb-1">
            <span>
              {t("agent.stats.budget.usd")}
              {!status.adapterIsCostBearing && ` · ${t("agent.stats.budget.informational")}`}
            </span>
            <span className="tabular-nums">
              {formatCents(status.usdTotalCents)}
              {status.usdLimitCents !== null
                ? ` / ${formatCents(status.usdLimitCents)} (${String(pct(status.usdTotalCents, status.usdLimitCents))}%)`
                : ` / ${t("agent.stats.budget.unset")}`}
            </span>
          </div>
          <Bar percent={pct(status.usdTotalCents, status.usdLimitCents)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-soft">{t("agent.stats.budget.tokenLimit")}</span>
          <input
            type="number"
            value={tokensInput}
            onChange={(e) => setTokensInput(e.target.value)}
            placeholder={t("agent.stats.budget.unset")}
            className="px-2 py-1 border border-surface-border rounded bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-soft">{t("agent.stats.budget.usdLimit")}</span>
          <input
            type="number"
            value={usdInput}
            onChange={(e) => setUsdInput(e.target.value)}
            placeholder={t("agent.stats.budget.unset")}
            className="px-2 py-1 border border-surface-border rounded bg-surface"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-soft">{t("agent.stats.budget.period")}</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}
            className="px-2 py-1 border border-surface-border rounded bg-surface"
          >
            <option value="daily">{t("agent.stats.budget.daily")}</option>
            <option value="monthly">{t("agent.stats.budget.monthly")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void save()}
          className="self-end px-3 py-1 bg-brand text-white rounded text-xs"
        >
          {t("agent.stats.budget.save")}
        </button>
      </div>
      {error !== null && <p className="mt-1 text-[10px] text-semantic-danger">{error}</p>}
    </div>
  );
};
