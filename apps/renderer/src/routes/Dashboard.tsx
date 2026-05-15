import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { useCompaniesStore } from "../stores/companies.js";
import { CostsTodayWidget } from "../components/costs/CostsTodayWidget.js";
import { ActiveAgentsWidget } from "../components/dashboard/ActiveAgentsWidget.js";
import { ActiveIssuesWidget } from "../components/dashboard/ActiveIssuesWidget.js";
import { InboxUnreadWidget } from "../components/dashboard/InboxUnreadWidget.js";
import { ActiveAgentsPanelWidget } from "../components/dashboard/ActiveAgentsPanelWidget.js";
import { GoalsProgressWidget } from "../components/dashboard/GoalsProgressWidget.js";
import { RecentActivityWidget } from "../components/dashboard/RecentActivityWidget.js";

export const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const loadAgents = useAgentsStore((s) => s.load);
  const companyId = useCompaniesStore((s) => s.activeId);

  const onCreateDemo = async () => {
    const company = await window.prospero.companies.createDemo();
    await useCompaniesStore.getState().load();
    await useCompaniesStore.getState().setActive(company.id);
    await loadAgents(company.id);
    const updated = useAgentsStore.getState().agents;
    if (updated.length > 0) navigate(`/agents/${updated[0]!.id}`);
  };

  if (companyId === null) {
    return (
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">{t("app.title")}</h1>
          <p className="text-ink-muted mt-2">{t("dashboard.emptyCompany")}</p>
        </div>
        <button
          onClick={() => void onCreateDemo()}
          className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded"
          type="button"
        >
          {t("dashboard.createDemoCompany")}
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{t("dashboard.title")}</h1>

      {agents.length === 0 && (
        <div className="bg-surface-card border border-surface-border rounded-lg p-5">
          <p className="text-sm text-ink-muted mb-3">{t("dashboard.noAgentsHint")}</p>
          <button
            onClick={() => void onCreateDemo()}
            className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded"
            type="button"
          >
            {t("dashboard.createDemoCompany")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActiveAgentsWidget />
        <ActiveIssuesWidget />
        <InboxUnreadWidget />
        <CostsTodayWidget companyId={companyId} />
        <ActiveAgentsPanelWidget />
        <GoalsProgressWidget />
      </div>

      <RecentActivityWidget companyId={companyId} />
    </div>
  );
};
