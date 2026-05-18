import { useState } from "react";
import { useTranslation } from "react-i18next";

type ParsedData = {
  company: string;
  projects: { name: string; path: string }[];
  roles?: {
    name: string;
    description?: string;
    model?: string;
    capabilities?: string[];
    icon?: string;
    charter?: string;
  }[];
  agents: {
    name: string;
    role: string;
    model?: string;
    reports_to?: string;
  }[];
};

type Props = {
  data: ParsedData;
  existingAgentNames: Set<string>;
  onCancel: () => void;
  onHire: (conflictModes: Record<string, "skip" | "replace">) => void;
  busy: boolean;
};

export const AgentsMdImportPreview = ({
  data,
  existingAgentNames,
  onCancel,
  onHire,
  busy,
}: Props) => {
  const { t } = useTranslation();
  const conflicts = data.agents.filter((a) => existingAgentNames.has(a.name));
  const [modes, setModes] = useState<Record<string, "skip" | "replace">>(() =>
    Object.fromEntries(conflicts.map((a) => [a.name, "skip" as const])),
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-surface-card border border-surface-border rounded-lg p-6 w-[640px] max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-brand-dark mb-1">
          {t("settings.agentsMd.previewTitle")}
        </h2>
        <p className="text-xs text-ink-muted mb-4">
          {t("settings.agentsMd.previewSubtitle", {
            projects: data.projects.length,
            roles: data.roles?.length ?? 0,
            agents: data.agents.length,
          })}
        </p>

        <ul className="text-sm space-y-1 mb-4">
          {data.agents.map((a) => (
            <li key={a.name} className="text-ink">
              <strong>{a.name}</strong> <span className="text-ink-muted">— {a.role}</span>
              {a.reports_to !== undefined && (
                <span className="text-ink-muted"> ↑ {a.reports_to}</span>
              )}
            </li>
          ))}
        </ul>

        {conflicts.length > 0 && (
          <div className="mb-4 border border-semantic-warning/50 rounded p-3 bg-semantic-warning/5">
            <p className="text-sm font-semibold text-semantic-warning mb-2">
              {t("settings.agentsMd.conflictHeader")}
            </p>
            <ul className="space-y-2">
              {conflicts.map((a) => (
                <li key={a.name} className="flex items-center justify-between text-sm">
                  <span className="text-ink">{a.name}</span>
                  <div className="flex gap-2">
                    <label className="text-xs">
                      <input
                        type="radio"
                        name={`mode-${a.name}`}
                        checked={modes[a.name] === "skip"}
                        onChange={() => setModes((m) => ({ ...m, [a.name]: "skip" }))}
                      />{" "}
                      {t("settings.agentsMd.conflictSkip")}
                    </label>
                    <label className="text-xs">
                      <input
                        type="radio"
                        name={`mode-${a.name}`}
                        checked={modes[a.name] === "replace"}
                        onChange={() => setModes((m) => ({ ...m, [a.name]: "replace" }))}
                      />{" "}
                      {t("settings.agentsMd.conflictReplace")}
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-surface-border rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onHire(modes)}
            disabled={busy}
            className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
          >
            {busy ? t("settings.agentsMd.hiring") : t("settings.agentsMd.hire")}
          </button>
        </div>
      </div>
    </div>
  );
};
