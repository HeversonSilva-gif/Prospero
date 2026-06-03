import { useEffect, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useBusinessPlanStore } from "../stores/businessPlan.js";
import { BusinessPlanReview } from "../components/BusinessPlanReview.js";
import { BusinessPlanOptions } from "../components/BusinessPlanOptions.js";
import type { BusinessPlanOption } from "@prospero/shared";

export const BusinessPlan: FC = () => {
  const { t } = useTranslation();
  const plan = useBusinessPlanStore((s) => s.plan);
  const loaded = useBusinessPlanStore((s) => s.loaded);
  const chosenIndex = useBusinessPlanStore((s) => s.chosenIndex);
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
      ) : plan.options !== null && chosenIndex === null ? (
        // 3-options genesis flow — show the chooser (Tela 1)
        <BusinessPlanOptions options={plan.options as BusinessPlanOption[]} />
      ) : (
        // Legacy single-plan OR user already chose an option → review (Tela 2)
        <BusinessPlanReview plan={plan} />
      )}
    </div>
  );
};
