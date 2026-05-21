import { useEffect, useState, type FC } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";

// When the CEO proposes an organization (submit_org_plan), the plan lands in the
// DB + an org_proposed inbox item, but neither Início nor the Pedir-algo
// conversation rendered it — so the user had nothing to approve. This banner
// surfaces a pending org plan wherever it is mounted and links to /org-plan.
//
// We poll instead of relying on a broadcast: the org_proposed inbox row is
// written by the MCP server child process (no BrowserWindow there), so
// inbox.onUpdate does NOT fire for it. A cheap getCurrent() poll is the reliable
// way to notice the plan once the CEO finishes.
export const OrgPlanProposedBanner: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useActiveCompanyId();
  const [roleCount, setRoleCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const plan = await window.prospero.orgPlan.getCurrent();
        if (!cancelled) setRoleCount(plan !== null ? plan.roles.length : null);
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

  if (roleCount === null) return null;

  return (
    <div className="px-6 py-3 bg-brand/10 border-b border-surface-border flex items-center gap-3">
      <span className="text-sm text-ink">{t("orgPlan.proposedBanner", { count: roleCount })}</span>
      <button
        type="button"
        onClick={() => navigate("/org-plan")}
        className="ml-auto text-xs px-3 py-1.5 bg-brand text-brand-fg rounded font-semibold whitespace-nowrap"
      >
        {t("orgPlan.reviewCta")}
      </button>
    </div>
  );
};

export default OrgPlanProposedBanner;
