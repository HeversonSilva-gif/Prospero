import { useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useOrgPlanStore } from "../stores/orgPlan.js";
import { OrgPlanReview } from "../components/OrgPlanReview.js";

export const OrgPlan: FC = () => {
  const { t } = useTranslation();
  const plan = useOrgPlanStore((s) => s.plan);
  const loaded = useOrgPlanStore((s) => s.loaded);
  const load = useOrgPlanStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-4">{t("orgPlan.pageTitle")}</h1>
      {!loaded ? (
        <p className="text-sm text-ink-muted">…</p>
      ) : plan === null ? (
        <p className="text-sm text-ink-muted">{t("orgPlan.none")}</p>
      ) : (
        <OrgPlanReview plan={plan} />
      )}
    </div>
  );
};
