// Scope selector (company / per-agent / per-project) + per-target dropdown +
// adapter filter + date range. All-string state for simplicity (refId="" → no filter).

import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, Project, CostsQueryScope } from "@dashboard-agent/shared";
import type { DateRange, CostsQueryFilters } from "../../hooks/useCostsQuery.js";

type Props = {
  filters: CostsQueryFilters;
  agents: Agent[];
  projects: Project[];
  onChange: (next: CostsQueryFilters) => void;
  onClear: () => void;
};

export const CostsFilters: FC<Props> = ({ filters, agents, projects, onChange, onClear }) => {
  const { t } = useTranslation();
  const setScope = (scope: CostsQueryScope): void => {
    onChange({ ...filters, scope, refId: "" });
  };
  const setRange = (range: DateRange): void => onChange({ ...filters, range });
  const setRefId = (refId: string): void => onChange({ ...filters, refId });
  const setAdapter = (adapterName: string): void => onChange({ ...filters, adapterName });

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-4 mb-6 flex flex-wrap gap-3 items-end">
      <label className="flex flex-col text-xs gap-1">
        <span className="text-ink-soft uppercase tracking-wide">{t("costs.filters.scope")}</span>
        <select
          value={filters.scope}
          onChange={(e) => setScope(e.target.value as CostsQueryScope)}
          className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm"
        >
          <option value="company">{t("costs.filters.scopeCompany")}</option>
          <option value="agent">{t("costs.filters.scopeAgent")}</option>
          <option value="project">{t("costs.filters.scopeProject")}</option>
        </select>
      </label>

      {filters.scope === "agent" && (
        <label className="flex flex-col text-xs gap-1">
          <span className="text-ink-soft uppercase tracking-wide">{t("costs.filters.agent")}</span>
          <select
            value={filters.refId}
            onChange={(e) => setRefId(e.target.value)}
            className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm min-w-[160px]"
          >
            <option value="">—</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {filters.scope === "project" && (
        <label className="flex flex-col text-xs gap-1">
          <span className="text-ink-soft uppercase tracking-wide">
            {t("costs.filters.project")}
          </span>
          <select
            value={filters.refId}
            onChange={(e) => setRefId(e.target.value)}
            className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm min-w-[160px]"
          >
            <option value="">—</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col text-xs gap-1">
        <span className="text-ink-soft uppercase tracking-wide">{t("costs.filters.adapter")}</span>
        <select
          value={filters.adapterName}
          onChange={(e) => setAdapter(e.target.value)}
          className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm"
        >
          <option value="">{t("costs.filters.adapterAll")}</option>
          <option value="claude-oauth-local">claude-oauth-local</option>
          <option value="claude-api-key-local">claude-api-key-local</option>
          <option value="claude-oauth-remote-docker">claude-oauth-remote-docker</option>
        </select>
      </label>

      <label className="flex flex-col text-xs gap-1">
        <span className="text-ink-soft uppercase tracking-wide">{t("costs.filters.range")}</span>
        <select
          value={filters.range}
          onChange={(e) => setRange(e.target.value as DateRange)}
          className="px-2 py-1.5 bg-surface-soft border border-surface-border rounded text-sm"
        >
          <option value="1d">{t("costs.filters.range1d")}</option>
          <option value="7d">{t("costs.filters.range7d")}</option>
          <option value="30d">{t("costs.filters.range30d")}</option>
        </select>
      </label>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto px-3 py-1.5 text-xs text-ink-muted hover:text-brand border border-surface-border rounded hover:border-brand"
      >
        {t("costs.filters.clear")}
      </button>
    </div>
  );
};
