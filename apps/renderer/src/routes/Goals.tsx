import { useEffect, useState, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGoalsStore } from "../stores/goals.js";
import { GoalsTree } from "../components/GoalsTree.js";

const useCompanyId = (): string | null => {
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const companies = await window.prospero.companies.list();
      if (companies.length > 0) setCompanyId(companies[0]!.id);
    })();
  }, []);
  return companyId;
};

export const Goals: FC = () => {
  const { t } = useTranslation();
  const companyId = useCompanyId();
  const goals = useGoalsStore((s) => s.goals);
  const loaded = useGoalsStore((s) => s.loaded);
  const load = useGoalsStore((s) => s.load);

  useEffect(() => {
    if (companyId !== null) {
      void load(companyId);
    }
  }, [companyId, load]);

  if (companyId === null) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-brand-dark mb-1">{t("goals.list.title")}</h1>
        <p className="text-sm text-ink-muted">{t("goals.list.empty")}</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark mb-1">{t("goals.list.title")}</h1>
          <p className="text-sm text-ink-muted">{t("goals.list.subtitle")}</p>
        </div>
        <Link
          to="/goals/new"
          className="px-3 py-1.5 bg-brand text-brand-fg text-sm rounded font-semibold hover:bg-brand-dark"
        >
          + {t("goals.list.new")}
        </Link>
      </div>

      {!loaded ? (
        <p className="text-sm text-ink-muted">{t("goals.list.loading")}</p>
      ) : goals.length === 0 ? (
        <div className="bg-surface-soft rounded p-6 text-center">
          <p className="text-sm text-ink-muted mb-3">{t("goals.list.emptyHint")}</p>
          <Link to="/goals/new" className="text-sm text-brand hover:underline font-semibold">
            {t("goals.list.createFirst")}
          </Link>
        </div>
      ) : (
        <GoalsTree goals={goals} />
      )}
    </div>
  );
};

export default Goals;
