import { useEffect, type FC } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRoutinesStore } from "../stores/routines.js";
import { useCompaniesStore } from "../stores/companies.js";
import { useAgentsStore } from "../stores/agents.js";
import { RoutineRow } from "../components/routines/RoutineRow.js";
import { EmptyState } from "../components/ui/EmptyState.js";

const ClockIcon: FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7 V12 L15 14" />
  </svg>
);

export const Routines: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const routines = useRoutinesStore((s) => s.routines);
  const loading = useRoutinesStore((s) => s.loading);
  const error = useRoutinesStore((s) => s.error);
  const load = useRoutinesStore((s) => s.load);
  const toggleEnabled = useRoutinesStore((s) => s.toggleEnabled);
  const runNow = useRoutinesStore((s) => s.runNow);
  const loadAgents = useAgentsStore((s) => s.load);
  const agentsLoaded = useAgentsStore((s) => s.loaded);

  useEffect(() => {
    if (activeCompanyId === null) return;
    void load(activeCompanyId);
    if (!agentsLoaded) void loadAgents(activeCompanyId);
  }, [activeCompanyId, load, agentsLoaded, loadAgents]);

  if (activeCompanyId === null) {
    return <div className="p-6 text-sm text-ink-muted">…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-brand-dark">{t("routines.title")}</h1>
          <p className="text-xs text-ink-muted mt-0.5">{t("routines.subtitle")}</p>
        </div>
        <Link
          to="/routines/new"
          className="text-xs font-semibold px-3 py-1.5 rounded bg-brand text-white"
        >
          + {t("routines.new")}
        </Link>
      </header>

      {error !== null && (
        <div className="mb-4 p-2 bg-semantic-danger-bg text-semantic-danger text-xs rounded border border-semantic-danger">
          {error}
        </div>
      )}

      {loading && routines === null ? (
        <p className="text-xs text-ink-muted p-2">…</p>
      ) : routines === null || routines.length === 0 ? (
        <EmptyState message={t("routines.empty.description")} icon={<ClockIcon />} />
      ) : (
        <div className="border-t border-surface-border bg-surface-card rounded">
          {routines.map((r) => (
            <RoutineRow
              key={r.id}
              routine={r}
              onToggle={() => toggleEnabled(r.id)}
              onRun={() => runNow(r.id)}
              onClick={() => navigate(`/routines/${r.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
