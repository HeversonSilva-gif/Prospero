import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../../stores/companies.js";
import { useAgentsStore } from "../../stores/agents.js";
import { AgentsMdImportPreview } from "./AgentsMdImportPreview.js";

type Parsed = {
  company: string;
  projects: { name: string; path: string }[];
  agents: {
    name: string;
    role: string;
    model?: string;
    skills?: string[];
    reports_to?: string;
    projects?: string[];
  }[];
};

export const AgentsMdImportSection = () => {
  const { t } = useTranslation();
  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const allAgents = useAgentsStore((s) => s.agents);
  const refreshAgents = useAgentsStore((s) => s.load);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [summary, setSummary] = useState<{
    projects: number;
    agents: number;
    warnings: string[];
  } | null>(null);

  const existingAgentNames = useMemo(
    () => new Set(allAgents.filter((a) => a.terminatedAt === null).map((a) => a.name)),
    [allAgents],
  );

  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSaved, setExportSaved] = useState<string | null>(null);

  const onPickFile = async (file: File): Promise<void> => {
    setBusy(true);
    setParseError(null);
    setParsed(null);
    setSummary(null);
    try {
      const raw = await file.text();
      const result = await window.prospero.agentsMd.parse(raw);
      if (!result.ok) {
        setParseError(t("settings.agentsMd.parseError", { error: result.error }));
        return;
      }
      setParsed(result.data);
    } finally {
      setBusy(false);
      if (fileInputRef.current !== null) fileInputRef.current.value = "";
    }
  };

  const onHire = async (conflictModes: Record<string, "skip" | "replace">): Promise<void> => {
    if (parsed === null || activeCompanyId === null) return;
    setBusy(true);
    try {
      const result = await window.prospero.agentsMd.hire(activeCompanyId, parsed, conflictModes);
      setSummary({
        projects: result.created.projects,
        agents: result.created.agents,
        warnings: result.warnings,
      });
      setParsed(null);
      await refreshAgents(activeCompanyId);
    } finally {
      setBusy(false);
    }
  };

  const onExport = async (): Promise<void> => {
    if (activeCompanyId === null) {
      setExportError(t("settings.agentsMd.exportNoCompany"));
      return;
    }
    setExportBusy(true);
    setExportError(null);
    setExportSaved(null);
    try {
      const { text } = await window.prospero.agentsMd.export(activeCompanyId);
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "AGENTS.md";
      a.click();
      URL.revokeObjectURL(url);
      setExportSaved(a.download);
    } catch (err) {
      setExportError(
        t("settings.agentsMd.exportError", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("settings.agentsMd.title")}
      </h2>
      <p className="text-xs text-ink-muted mb-3">{t("settings.agentsMd.subtitle")}</p>

      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void onPickFile(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || activeCompanyId === null}
          className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
        >
          {busy ? t("settings.agentsMd.parsing") : t("settings.agentsMd.actionImport")}
        </button>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={exportBusy || activeCompanyId === null}
          className="px-3 py-1.5 text-sm border border-surface-border rounded disabled:opacity-50"
        >
          {exportBusy ? t("settings.agentsMd.exporting") : t("settings.agentsMd.actionExport")}
        </button>
      </div>

      {parseError !== null && <p className="mt-2 text-xs text-semantic-danger">{parseError}</p>}
      {summary !== null && (
        <div className="mt-3 text-xs space-y-1">
          <p className="text-semantic-success">
            {t("settings.agentsMd.summarySuccess", {
              projects: summary.projects,
              agents: summary.agents,
            })}
          </p>
          {summary.warnings.length > 0 && (
            <details className="text-ink-muted">
              <summary className="cursor-pointer">
                {t("settings.agentsMd.warningsCount", { count: summary.warnings.length })}
              </summary>
              <ul className="pl-3 list-disc mt-1">
                {summary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {exportError !== null && <p className="mt-2 text-xs text-semantic-danger">{exportError}</p>}
      {exportSaved !== null && (
        <p className="mt-2 text-xs text-semantic-success">
          {t("settings.agentsMd.exportSaved", { path: exportSaved })}
        </p>
      )}

      {parsed !== null && (
        <AgentsMdImportPreview
          data={parsed}
          existingAgentNames={existingAgentNames}
          onCancel={() => setParsed(null)}
          onHire={(modes) => void onHire(modes)}
          busy={busy}
        />
      )}
    </section>
  );
};
