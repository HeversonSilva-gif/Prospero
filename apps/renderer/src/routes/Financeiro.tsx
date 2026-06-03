import { type FC, type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CurrencyDollar } from "@phosphor-icons/react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { FinanceSummary } from "@prospero/shared";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";
import { useFinanceStore } from "../stores/finance.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { Section } from "../components/ui/Section.js";
import { formatMoney, formatUsdCents, formatMonthLabel } from "../lib/finance/formatMoney.js";

const WINDOWS = [30, 90, 365];

const Kpi: FC<{ label: string; value: string; sub?: string; accent?: boolean }> = ({
  label,
  value,
  sub,
  accent = false,
}) => (
  <div className="flex flex-col gap-1 p-4 rounded-lg bg-surface-card border border-surface-border">
    <span className="text-[10px] uppercase tracking-wide font-semibold text-ink-soft">{label}</span>
    <span
      className={`text-2xl font-bold tabular-nums leading-none ${accent ? "text-brand-dark" : "text-ink"}`}
    >
      {value}
    </span>
    {sub !== undefined && <span className="text-xs text-ink-muted">{sub}</span>}
  </div>
);

const Card: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="bg-surface-card border border-surface-border rounded-lg p-5">{children}</div>
);

// Compact axis label, e.g. 1234567 cents BRL → "R$12k". Keeps the y-axis legible.
const compactMajor = (cents: number, currency: string): string => {
  const v = cents / 100;
  const sym = currency.toUpperCase() === "BRL" ? "R$" : "";
  if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${sym}${(v / 1000).toFixed(0)}k`;
  return `${sym}${String(Math.round(v))}`;
};

const Panorama: FC<{ s: FinanceSummary }> = ({ s }) => {
  const { t } = useTranslation();
  const chartData = s.revenueByMonth.map((m) => ({
    label: formatMonthLabel(m.month),
    value: m.revenueCents / 100,
    cents: m.revenueCents,
  }));

  const churnCard =
    s.churnRatePct !== null
      ? { label: t("financeiro.kpi.churn"), value: `${s.churnRatePct.toLocaleString("pt-BR")}%` }
      : s.repeatPurchaseRatePct !== null
        ? {
            label: t("financeiro.kpi.repeat"),
            value: `${s.repeatPurchaseRatePct.toLocaleString("pt-BR")}%`,
          }
        : { label: t("financeiro.kpi.churn"), value: "—" };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label={t("financeiro.kpi.lifetime")}
          value={formatMoney(s.lifetimeRevenueCents, s.currency)}
          sub={t("financeiro.kpi.lifetimeSub")}
          accent
        />
        <Kpi
          label={t("financeiro.kpi.mrr")}
          value={formatMoney(s.mrrCents, s.currency)}
          sub={t("financeiro.kpi.mrrSub", { count: s.activeSubscriptions })}
        />
        <Kpi {...churnCard} sub={t("financeiro.kpi.windowSub", { days: s.windowDays })} />
        <Kpi
          label={t("financeiro.kpi.customers")}
          value={s.activeCustomers.toLocaleString("pt-BR")}
          sub={t("financeiro.kpi.customersSub", { count: s.newCustomers })}
        />
      </div>

      <Card>
        <h3 className="text-[10px] uppercase tracking-wide text-ink-soft font-semibold mb-3">
          {t("financeiro.revenueOverTime")}
        </h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="finRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0F766E" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#0F766E" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v: number) => compactMajor(v * 100, s.currency)}
              tick={{ fontSize: 11 }}
              width={52}
            />
            <Tooltip
              formatter={(v) => formatMoney(typeof v === "number" ? v * 100 : 0, s.currency)}
              contentStyle={{
                fontSize: 12,
                background: "var(--c-bg-card)",
                border: "1px solid var(--c-border)",
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={t("financeiro.revenue")}
              stroke="#0F766E"
              strokeWidth={2}
              fill="url(#finRev)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <Section title={t("financeiro.topProducts")}>
            {s.topProducts.length === 0 ? (
              <p className="text-xs text-ink-soft py-2">{t("financeiro.noProducts")}</p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {s.topProducts.map((p) => (
                  <li key={p.name} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-ink truncate">{p.name}</p>
                      <p className="text-[11px] text-ink-soft">
                        {t("financeiro.activeCount", { count: p.activeCount })}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-brand-dark">
                      {formatMoney(p.mrrCents, s.currency)}
                      <span className="text-[10px] font-normal text-ink-soft">
                        {t("financeiro.perMonth")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </Card>

        <Card>
          <Section title={t("financeiro.costVsRevenue")}>
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">
                  {t("financeiro.revenueWindow", { days: s.windowDays })}
                </span>
                <span className="text-sm font-semibold tabular-nums text-brand-dark">
                  {formatMoney(s.windowRevenueCents, s.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">{t("financeiro.aiCost")}</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {formatUsdCents(s.costCents)}
                </span>
              </div>
              <div
                className={`text-xs rounded-md px-3 py-2 ${
                  s.windowRevenueCents > 0
                    ? "bg-semantic-success-bg text-semantic-success"
                    : "bg-semantic-warning-bg text-ink"
                }`}
              >
                {s.windowRevenueCents > 0
                  ? t("financeiro.statusEarning")
                  : t("financeiro.statusNoRevenue")}
              </div>
            </div>
          </Section>
        </Card>
      </div>
    </div>
  );
};

const Financeiro: FC = () => {
  const { t } = useTranslation();
  const companyId = useActiveCompanyId();
  const { summary, days, loading, error, load } = useFinanceStore();

  useEffect(() => {
    if (companyId === null) return;
    void load(companyId, days);
  }, [companyId, days, load]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">{t("financeiro.title")}</h1>
          <p className="text-sm text-ink-muted">{t("financeiro.subtitle")}</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-soft p-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => companyId !== null && void load(companyId, w)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                days === w
                  ? "bg-surface-card text-brand-dark shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {t("financeiro.windowDays", { days: w })}
            </button>
          ))}
        </div>
      </header>

      {error !== null && (
        <div className="text-sm text-semantic-danger bg-semantic-danger-bg rounded-md px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {summary === null && loading && (
        <p className="text-sm text-ink-muted p-8">{t("financeiro.loading")}</p>
      )}

      {summary !== null && !summary.hasStripe && (
        <EmptyState message={t("financeiro.empty")} icon={<CurrencyDollar />} />
      )}

      {summary !== null && summary.hasStripe && <Panorama s={summary} />}
    </div>
  );
};

export default Financeiro;
