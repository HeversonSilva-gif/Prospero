import { useEffect, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBriefingStore } from "../stores/briefing.js";
import { useCompaniesStore } from "../stores/companies.js";
import { useAgentsStore } from "../stores/agents.js";
import { formatCents } from "../lib/costs/formatCents.js";
import { StatCard } from "../components/inicio/StatCard.js";
import { TeamMemberRow } from "../components/inicio/TeamMemberRow.js";
import {
  CheckCircleIcon,
  PlayIcon,
  CreditCardIcon,
  AlertTriangleIcon,
} from "../components/inicio/inicio-icons.js";
import type { BriefingItem } from "@prospero/shared";

// M14 PR-C laid the data flow (useBriefingStore + subscribeInbox); M16 PR-B1
// reskins this route for the new "Início" layout per spec §5. The cached
// `briefing.headline` is no longer surfaced — the saudação subline replaces it.
// Sub-buckets (verified/failed/inProgress/learned) are gone; their detail is
// reachable via /goals, /issues, etc.

const NeedsYouRow: FC<{ item: BriefingItem; verLabel: string }> = ({ item, verLabel }) => (
  <div className="flex items-center gap-3 px-3 py-2.5 border-t border-surface-border first:border-t-0">
    <span
      className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 bg-semantic-warning-bg text-semantic-warning"
      aria-hidden="true"
    >
      <AlertTriangleIcon size={17} />
    </span>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-ink truncate">{item.label}</p>
      {item.detail !== "" && <p className="text-xs text-ink-soft truncate">{item.detail}</p>}
    </div>
    <Link
      to={item.route}
      className="text-xs font-semibold px-3 py-1.5 rounded-md bg-brand text-white whitespace-nowrap"
    >
      {verLabel}
    </Link>
  </div>
);

export const Briefing: FC = () => {
  const { t } = useTranslation();
  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const briefing = useBriefingStore((s) => s.briefing);
  const loading = useBriefingStore((s) => s.loading);
  const error = useBriefingStore((s) => s.error);
  const load = useBriefingStore((s) => s.load);
  const markReviewed = useBriefingStore((s) => s.markReviewed);
  const subscribeInbox = useBriefingStore((s) => s.subscribeInbox);
  const agents = useAgentsStore((s) => s.agents.filter((a) => a.status !== "terminated"));

  useEffect(() => {
    if (activeCompanyId === null) return;
    void load(activeCompanyId);
    const off = subscribeInbox(activeCompanyId);
    return off;
  }, [activeCompanyId, load, subscribeInbox]);

  if (activeCompanyId === null) {
    return (
      <div className="p-8">
        <p className="text-sm text-ink-muted">{t("inicio.noCompany")}</p>
      </div>
    );
  }

  if (loading && briefing === null) {
    return (
      <div className="p-8">
        <p className="text-sm text-ink-muted">{t("inicio.loading")}</p>
      </div>
    );
  }

  if (error !== null && briefing === null) {
    return (
      <div className="p-8">
        <p role="alert" className="text-sm text-semantic-danger">
          {error}
        </p>
      </div>
    );
  }

  if (briefing === null) return null;

  const needsYouCount = briefing.needsYou.length;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      {/* Saudação */}
      <header>
        <h1 className="text-2xl font-bold text-ink">{t("inicio.greeting")}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t("inicio.subline")}</p>
      </header>

      {/* Precisa de você */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
            {t("inicio.precisaDeVoce")}
          </h2>
          {needsYouCount > 0 && (
            <button
              type="button"
              onClick={() => void markReviewed(activeCompanyId)}
              className="text-xs text-ink-muted hover:text-ink"
            >
              {t("inicio.markReviewed")}
            </button>
          )}
        </div>
        <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
          {needsYouCount === 0 ? (
            <p className="text-sm text-ink-muted italic px-4 py-6 text-center">
              {t("inicio.precisaDeVoceEmpty")}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-border">
                <p className="text-sm font-semibold text-ink">
                  {t("inicio.precisaDeVoceCount", { count: needsYouCount })}
                </p>
                <span className="text-[11px] font-bold bg-semantic-warning text-ink rounded-full px-2 py-0.5">
                  {needsYouCount}
                </span>
              </div>
              {briefing.needsYou.map((item) => (
                <NeedsYouRow key={item.id} item={item} verLabel={t("inicio.verButton")} />
              ))}
            </>
          )}
        </div>
      </section>

      {/* O que aconteceu esta noite */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-soft mb-2">
          {t("inicio.oQueAconteceu")}
        </h2>
        <div className="flex gap-3">
          <StatCard
            icon={<CheckCircleIcon size={17} />}
            iconBg="bg-semantic-success-bg"
            iconColor="text-semantic-success"
            value={String(briefing.verified.length)}
            label={t("inicio.tarefasConcluidas")}
          />
          <StatCard
            icon={<PlayIcon size={15} />}
            iconBg="bg-surface-soft"
            iconColor="text-ink-muted"
            value={String(briefing.inProgress.length)}
            label={t("inicio.emAndamento")}
          />
          <StatCard
            icon={<CreditCardIcon size={17} />}
            iconBg="bg-surface-soft"
            iconColor="text-ink-muted"
            value={formatCents(briefing.costCents)}
            label={t("inicio.gastosHoje")}
          />
        </div>
      </section>

      {/* Sua equipe agora */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-soft mb-2">
          {t("inicio.suaEquipeAgora")}
        </h2>
        <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
          {agents.length === 0 ? (
            <p className="text-sm text-ink-muted italic px-4 py-6 text-center">
              {t("inicio.suaEquipeAgoraEmpty")}
            </p>
          ) : (
            agents.map((agent) => <TeamMemberRow key={agent.id} agent={agent} />)
          )}
        </div>
      </section>
    </div>
  );
};
