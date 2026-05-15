import { useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  CLAUDE_MODEL_PRESETS,
  MODEL_ID_REGEX,
  SKILL_CATALOG,
  type Agent,
  type RoleTemplate,
} from "@prospero/shared";
import { useAgentsStore } from "../../stores/agents.js";
import { useProjectsStore } from "../../stores/projects.js";
import { useSettingsStore } from "../../stores/settings.js";
import { AgentProjectsEditor } from "./AgentProjectsEditor.js";
import { ChangeRoleModal } from "./ChangeRoleModal.js";
import { categorizeSkills } from "./skillCategorize.js";
import { InstructionsFullScreenModal } from "./InstructionsFullScreenModal.js";

type Props = { agent: Agent };

export const ConfigTab: FC<Props> = ({ agent }) => {
  const { t } = useTranslation();
  const setModel = useAgentsStore((s) => s.setModel);
  const setRole = useAgentsStore((s) => s.setRole);
  const setSystemPrompt = useAgentsStore((s) => s.setSystemPrompt);
  const setReportsTo = useAgentsStore((s) => s.setReportsTo);
  const setMode = useAgentsStore((s) => s.setMode);
  const setAlwaysOn = useAgentsStore((s) => s.setAlwaysOn);
  const setSkills = useAgentsStore((s) => s.setSkills);
  const wakeUp = useAgentsStore((s) => s.wakeUp);
  const setAdapter = useAgentsStore((s) => s.setAdapter);
  const allAgents = useAgentsStore((s) => s.agents);
  const allProjects = useProjectsStore((s) => s.projects);
  const authMode = useSettingsStore((s) => s.settings.authMode);

  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [modelPreset, setModelPreset] = useState<string>("");
  const [customModel, setCustomModel] = useState<string>("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [persona, setPersona] = useState(agent.systemPrompt);
  const [personaSavedAt, setPersonaSavedAt] = useState<number | null>(null);
  const [showInstructionsExpand, setShowInstructionsExpand] = useState(false);

  useEffect(() => {
    void (async () => {
      const list = await window.prospero.roles.list();
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

  const otherAgents = useMemo(
    () => allAgents.filter((a) => a.id !== agent.id && a.status !== "terminated"),
    [allAgents, agent.id],
  );

  const allSkillIds = useMemo(() => Object.keys(SKILL_CATALOG), []);
  const categorizedSkills = useMemo(
    () =>
      categorizeSkills({
        agentSkills: agent.skills,
        roleDefaultSkills: currentRole?.defaultSkills ?? [],
        allSkills: allSkillIds,
      }),
    [agent.skills, currentRole?.defaultSkills, allSkillIds],
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
          {t("agent.config.reportsTo.label")}
        </h3>
        <select
          value={agent.reportsTo ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            void setReportsTo(agent.id, v === "" ? null : v);
          }}
          className="w-full px-2 py-1 border border-surface-border rounded bg-surface text-xs"
        >
          <option value="">{t("agent.config.reportsTo.none")}</option>
          {otherAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.location.label")}
        </h3>
        <div className="flex gap-3 text-xs">
          {(["local", "remote"] as const).map((loc) => {
            const isRemote = agent.adapterName === "claude-oauth-remote-docker";
            const current = isRemote ? "remote" : "local";
            return (
              <label key={loc} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`location-${agent.id}`}
                  checked={current === loc}
                  onChange={() => {
                    const adapterName =
                      loc === "remote"
                        ? "claude-oauth-remote-docker"
                        : authMode === "api-key"
                          ? "claude-api-key-local"
                          : "claude-oauth-local";
                    void setAdapter(agent.id, adapterName);
                  }}
                />
                {t(`agent.location.${loc}`)}
              </label>
            );
          })}
        </div>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.location.hint")}</p>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.mode.label")}
        </h3>
        <div className="flex gap-3 text-xs">
          {(["supervised", "auto"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name={`mode-${agent.id}`}
                checked={agent.mode === m}
                onChange={() => void setMode(agent.id, m)}
              />
              {t(`agent.config.mode.${m}`)}
            </label>
          ))}
        </div>
      </section>

      <section>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={agent.alwaysOn}
            onChange={(e) => void setAlwaysOn(agent.id, e.target.checked)}
          />
          <span className="text-ink">{t("agent.config.alwaysOn.label")}</span>
        </label>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.config.alwaysOn.hint")}</p>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.schedule.label")}
        </h3>
        <button
          type="button"
          onClick={() => void wakeUp(agent.id)}
          disabled={agent.status === "paused" || agent.status === "terminated"}
          className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded disabled:opacity-50"
        >
          ▶ {t("agent.config.schedule.wakeUp")}
        </button>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.config.schedule.wakeUpHint")}</p>
      </section>

      <section>
        <h3 className="text-[10px] uppercase text-ink-soft font-semibold mb-2">
          {t("agent.config.skills.label")}
        </h3>
        {categorizedSkills.required.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
              {t("agent.config.skillsEdit.required")}
            </p>
            {categorizedSkills.required.map((s) => (
              <label key={s.id} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={s.enabled} disabled />
                <span>{s.id}</span>
              </label>
            ))}
          </div>
        )}

        {categorizedSkills.optional.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
              {t("agent.config.skillsEdit.optional")}
            </p>
            {categorizedSkills.optional.map((s) => (
              <label key={s.id} className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...agent.skills, s.id]
                      : agent.skills.filter((id) => id !== s.id);
                    void setSkills(agent.id, next);
                  }}
                />
                <span>{s.id}</span>
              </label>
            ))}
          </div>
        )}

        {categorizedSkills.available.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return;
              void setSkills(agent.id, [...agent.skills, v]);
            }}
            className="text-xs px-2 py-1 border border-surface-border rounded bg-surface w-full mt-1"
          >
            <option value="">{t("agent.config.skillsEdit.addLabel")}</option>
            {categorizedSkills.available.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
      </section>

      <section>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-[10px] uppercase text-ink-soft font-semibold">
            {t("agent.config.persona.label")}
          </h3>
          <button
            type="button"
            onClick={() => setShowInstructionsExpand(true)}
            className="text-[10px] text-ink-soft hover:text-brand underline"
          >
            {t("agent.instructions.expand")}
          </button>
        </div>
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

      {showInstructionsExpand && (
        <InstructionsFullScreenModal
          initialValue={persona}
          onSave={(v) => {
            setPersona(v);
            void setSystemPrompt(agent.id, v);
            setPersonaSavedAt(Date.now());
          }}
          onClose={() => setShowInstructionsExpand(false)}
        />
      )}
    </div>
  );
};
