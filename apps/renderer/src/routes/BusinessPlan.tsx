import { useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useBusinessPlanStore } from "../stores/businessPlan.js";
import { BusinessPlanReview } from "../components/BusinessPlanReview.js";

export const BusinessPlan: FC = () => {
  const { t } = useTranslation();
  const plan = useBusinessPlanStore((s) => s.plan);
  const loaded = useBusinessPlanStore((s) => s.loaded);
  const load = useBusinessPlanStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-4">{t("businessPlan.pageTitle")}</h1>
      {!loaded ? (
        <p className="text-sm text-ink-muted">…</p>
      ) : plan === null ? (
        <p className="text-sm text-ink-muted">{t("businessPlan.none")}</p>
      ) : (
        <BusinessPlanReview plan={plan} />
      )}
    </div>
  );
};
