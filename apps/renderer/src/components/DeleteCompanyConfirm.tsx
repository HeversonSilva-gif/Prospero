import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../stores/companies.js";
import { useAgentsStore } from "../stores/agents.js";
import { useIssuesStore } from "../stores/issues.js";
import { useProjectsStore } from "../stores/projects.js";

type Props = { companyId: string; onClose: () => void };

export const DeleteCompanyConfirm = ({ companyId, onClose }: Props) => {
  const { t } = useTranslation();
  const companies = useCompaniesStore((s) => s.companies);
  const activeId = useCompaniesStore((s) => s.activeId);
  const deleteFn = useCompaniesStore((s) => s.delete);
  const agents = useAgentsStore((s) => s.agents);
  const issues = useIssuesStore((s) => s.issues);
  const projects = useProjectsStore((s) => s.projects);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = companies.find((c) => c.id === companyId);
  const isLastCompany = companies.length === 1;
  const isActive = activeId === companyId;
  const agentCount = isActive ? agents.length : 0;
  const issueCount = isActive ? issues.length : 0;
  const projectCount = isActive ? projects.length : 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteFn(companyId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (target === undefined) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-2 text-semantic-danger">
          {t("company.delete.title")}
        </h2>
        <p className="text-sm text-ink mb-2">{t("company.delete.body", { name: target.name })}</p>
        {isActive && (agentCount > 0 || issueCount > 0 || projectCount > 0) && (
          <p className="text-xs text-ink-muted mb-2">
            {t("company.delete.cascadeCounts", {
              agents: agentCount,
              issues: issueCount,
              projects: projectCount,
            })}
          </p>
        )}
        {!isActive && (
          <p className="text-xs text-ink-muted mb-2">{t("company.delete.cascadeWarning")}</p>
        )}
        {isLastCompany && (
          <p className="text-xs text-semantic-warning mb-2">{t("company.delete.lastWarning")}</p>
        )}
        {error !== null && <p className="mt-2 text-xs text-semantic-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-soft rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-semantic-danger text-white rounded disabled:opacity-50"
          >
            {busy ? t("company.delete.deleting") : t("company.delete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
