import { useEffect, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBriefingStore } from "../stores/briefing.js";
import { useCompaniesStore } from "../stores/companies.js";
import { useAgentsStore } from "../stores/agents.js";
import { NeedsYouCard } from "../components/inicio/NeedsYouCard.js";
import { HojeTimeline } from "../components/inicio/HojeTimeline.js";
import { TeamMemberRow } from "../components/inicio/TeamMemberRow.js";
import { OrgPlanProposedBanner } from "../components/OrgPlanProposedBanner.js";

const SectionLabel: FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({
  children,
  action,
}) => (
  <div className="flex items-center mb-2.5">
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-soft">
      {children}
    </h2>
    {action !== undefined && <div className="ml-auto text-[11px] text-brand">{action}</div>}
  </div>
);

export const Briefing: FC = () => {
  const { t } = useTranslation();
  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const briefing = useBriefingStore((s) => s.briefing);
  const loading = useBriefingStore((s) => s.loading);
  const error = useBriefingStore((s) => s.error);
  const load = useBriefingStore((s) => s.load);
  const subscribeInbox = useBriefingStore((s) => s.subscribeInbox);
  const agents = useAgentsStore((s) => s.agents.filter((a) => a.status !== "terminated"));

  useEffect(() => {
    if (activeCompanyId === null) return;
    void load(activeCompanyId);
    const off = subscribeInbox(activeCompanyId);
    return off;
  }, [activeCompanyId, load, subscribeInbox]);

  if (activeCompanyId === null)
    return (
      <div className="p-8">
        <p className="text-sm text-ink-muted">{t("inicio.noCompany")}</p>
      </div>
    );
  if (loading && briefing === null)
    return (
      <div className="p-8">
        <p className="text-sm text-ink-muted">{t("inicio.loading")}</p>
      </div>
    );
  if (error !== null && briefing === null)
    return (
      <div className="p-8">
        <p role="alert" className="text-sm text-semantic-danger">
          {error}
        </p>
      </div>
    );
  if (briefing === null) return null;

  return (
    <div className="px-8 py-7 mx-auto max-w-2xl flex flex-col gap-7">
      <OrgPlanProposedBanner />

      <header>
        <h1 className="text-[25px] font-semibold tracking-[-0.025em] text-ink">
          {t("inicio.greeting")}
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-muted">{t("inicio.subline")}</p>
      </header>

      <section>
        <SectionLabel>{t("inicio.precisaDeVoce")}</SectionLabel>
        <NeedsYouCard items={briefing.needsYou} />
      </section>

      <section>
        <SectionLabel action={<Link to="/goals">{t("inicio.verTudo")}</Link>}>
          {t("inicio.hoje")}
        </SectionLabel>
        <HojeTimeline items={briefing.verified} />
      </section>

      <section>
        <SectionLabel action={<Link to="/agents">{t("inicio.verEquipe")}</Link>}>
          {t("inicio.suaEquipeAgora")}
        </SectionLabel>
        <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
          {agents.length === 0 ? (
            <p className="text-sm text-ink-muted px-4 py-6 text-center">
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
