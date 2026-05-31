import { useEffect, useState, type FC } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";

// When the CEO proposes a business plan (submit_business_plan), the plan lands in
// the DB but neither Início nor the genesis conversation renders it — so the user
// has nothing to review. This banner surfaces a pending business plan wherever it
// is mounted and links to /business-plan.
//
// We poll instead of relying on a broadcast: the plan is written by the MCP server
// child process (no BrowserWindow there), so no broadcast fires for it. A cheap
// getCurrent() poll is the reliable way to notice the plan once the CEO finishes.
export const BusinessPlanProposedBanner: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useActiveCompanyId();
  const [proposed, setProposed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const plan = await window.prospero.businessPlan.getCurrent();
        if (!cancelled) setProposed(plan !== null);
      } catch {
        /* ignore — banner is best-effort */
      }
    };
    void check();
    const id = setInterval(() => void check(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [companyId]);

  if (!proposed) return null;

  return (
    <div className="px-6 py-3 bg-brand/10 border-b border-surface-border flex items-center gap-3">
      <span className="text-sm text-ink">{t("businessPlan.proposedBanner")}</span>
      <button
        type="button"
        onClick={() => navigate("/business-plan")}
        className="ml-auto text-xs px-3 py-1.5 bg-brand text-brand-fg rounded font-semibold whitespace-nowrap"
      >
        {t("businessPlan.reviewCta")}
      </button>
    </div>
  );
};

export default BusinessPlanProposedBanner;
