import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";

export const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const loadAgents = useAgentsStore((s) => s.load);

  const onCreateDemo = async () => {
    const company = await window.dashboardAgent.companies.createDemo();
    await loadAgents(company.id);
    const updated = useAgentsStore.getState().agents;
    if (updated.length > 0) navigate(`/agents/${updated[0]!.id}`);
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-brand-dark">{t("app.title")}</h1>
      <p className="text-ink-muted mt-2">{t("dashboard.placeholder")}</p>
      {agents.length === 0 && (
        <button
          onClick={() => void onCreateDemo()}
          className="mt-6 px-4 py-2 bg-brand text-white text-sm font-semibold rounded"
          type="button"
        >
          {t("dashboard.createDemoCompany")}
        </button>
      )}
    </div>
  );
};
