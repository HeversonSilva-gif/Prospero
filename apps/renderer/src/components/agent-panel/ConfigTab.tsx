import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  CLAUDE_MODEL_PRESETS,
  MODEL_ID_REGEX,
  type Agent,
  type RoleTemplate,
} from "@dashboard-agent/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { useProjectsStore } from "../../stores/projects.js";
import { AgentProjectsEditor } from "./AgentProjectsEditor.js";
import { ChangeRoleModal } from "./ChangeRoleModal.js";

type Props = { agent: Agent };

export const ConfigTab: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const setModel = useAgentsStore((s) => s.setModel);
  const setRole = useAgentsStore((s) => s.setRole);
  const setSystemPrompt = useAgentsStore((s) => s.setSystemPrompt);
  const allProjects = useProjectsStore((s) => s.projects);

  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [modelPreset, setModelPreset] = useState<string>("");
  const [customModel, setCustomModel] = useState<string>("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [persona, setPersona] = useState(agent.systemPrompt);
  const [personaSavedAt, setPersonaSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const list = await window.dashboardAgent.roles.list();
      setRoles(list);
    })();
  }, []);

  useEffect(() => {
    setPersona(agent.systemPrompt);
    if ((CLAUDE_MODEL_PRESETS as readonly string[]).includes(agent.model)) {
      setModelPreset(agent.model);
      setCustomModel("");
    } else {
      setModelPreset("custom");
      setCustomModel(agent.model);
    }
  }, [agent.id, agent.systemPrompt, agent.model]);

  const currentRole = useMemo(
    () => roles.find((r) => r.id === agent.templateId) ?? null,
    [roles, agent.templateId],
  );

  const onModelPresetChange = async (v: string): Promise<void> => {
    setModelPreset(v);
    setModelError(null);
    if (v === "custom") return;
    await setModel(agent.id, v);
  };

  const onCustomModelBlur = async (): Promise<void> => {
    const v = customModel.trim();
    if (v === "" || v === agent.model) return;
    if (!MODEL_ID_REGEX.test(v)) {
      setModelError(t("agent.config.model.invalid"));
      return;
    }
    setModelError(null);
    await setModel(agent.id, v);
  };

  // Debounced persona save (500ms).
  useEffect(() => {
    if (persona === agent.systemPrompt) return;
    const handle = setTimeout(() => {
      void (async () => {
        await setSystemPrompt(agent.id, persona);
        setPersonaSavedAt(Date.now());
      })();
    }, 500);
    return () => clearTimeout(handle);
  }, [persona, agent.id, agent.systemPrompt, setSystemPrompt]);

  return (
    <div className="p-4 space-y-5 text-xs">
      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.role.label")}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-ink font-medium">
            {currentRole !== null ? currentRole.name : agent.role || "—"}
          </span>
          <button
            type="button"
            onClick={() => setShowRoleModal(true)}
            className="text-[10px] px-2 py-0.5 rounded bg-surface-soft text-ink-muted hover:text-brand"
          >
            {t("agent.config.role.change")}
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.model.label")}
        </h3>
        <select
          value={modelPreset}
          onChange={(e) => void onModelPresetChange(e.target.value)}
          className="w-full px-2 py-1 border border-surface-border rounded bg-surface text-xs"
        >
          {CLAUDE_MODEL_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="custom">{t("agent.config.model.custom")}</option>
        </select>
        {modelPreset === "custom" && (
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            onBlur={() => void onCustomModelBlur()}
            placeholder="claude-..."
            className="mt-2 w-full px-2 py-1 border border-surface-border rounded bg-surface text-xs font-mono"
          />
        )}
        {modelError !== null && (
          <p className="mt-1 text-[10px] text-semantic-danger">{modelError}</p>
        )}
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.skills.label")}
        </h3>
        <div className="flex gap-1 flex-wrap">
          {agent.skills.length === 0 ? (
            <span className="text-[11px] text-ink-soft italic">
              {t("agent.config.skills.empty")}
            </span>
          ) : (
            agent.skills.map((s) => (
              <span
                key={s}
                className="text-[10px] px-2 py-0.5 rounded-full bg-surface-soft text-ink-muted"
              >
                {s}
              </span>
            ))
          )}
        </div>
        <p className="text-[10px] text-ink-soft italic mt-1">{t("agent.config.skills.hint")}</p>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.persona.label")}
        </h3>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          rows={6}
          className="w-full px-2 py-1.5 border border-surface-border rounded bg-surface text-xs font-mono leading-relaxed"
        />
        {personaSavedAt !== null && (
          <p className="text-[10px] text-semantic-success mt-1">
            {t("agent.config.persona.saved")}
          </p>
        )}
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.projects.label")}
        </h3>
        <AgentProjectsEditor agent={agent} allProjects={allProjects} />
      </section>

      {showRoleModal && (
        <ChangeRoleModal
          currentRoleId={agent.templateId}
          onCancel={() => setShowRoleModal(false)}
          onConfirm={async (roleId, preserveModel) => {
            await setRole(agent.id, roleId, { preserveModel });
            setShowRoleModal(false);
          }}
        />
      )}
    </div>
  );
};
