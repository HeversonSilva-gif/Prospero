import { useEffect, useState, type FC, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { useRolesStore } from "../stores/roles.js";
import { useSettingsStore } from "../stores/settings.js";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";

export const AgentNew: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTemplate = searchParams.get("template") ?? "";
  const settings = useSettingsStore((s) => s.settings);
  const hireFromUi = useAgentsStore((s) => s.hireFromUi);
  const agents = useAgentsStore((s) => s.agents);
  const roles = useRolesStore((s) => s.roles);
  const loadRoles = useRolesStore((s) => s.load);

  const companyId = useActiveCompanyId();
  const [name, setName] = useState("");
  const [roleTemplateId, setRoleTemplateId] = useState<string>(initialTemplate);
  const [reportsTo, setReportsTo] = useState("");
  const [mode, setMode] = useState<"supervised" | "auto">(settings.defaultAgentMode);
  const [location, setLocation] = useState<"local" | "remote">("local");
  const [persona, setPersona] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const selected = roles.find((r) => r.id === roleTemplateId);

  useEffect(() => {
    if (selected !== undefined && persona === "") setPersona(selected.defaultSystemPrompt);
  }, [selected, persona]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (companyId === null) return;
    if (name.trim() === "") {
      setError(t("agent.new.errors.nameRequired"));
      return;
    }
    if (persona.length < 20) {
      setError(t("agent.new.errors.personaTooShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await hireFromUi({
        company_id: companyId,
        name: name.trim(),
        role: selected?.name ?? "Agent",
        system_prompt: persona,
        mode,
        location,
        ...(reportsTo !== "" ? { reports_to: reportsTo } : {}),
        ...(roleTemplateId !== "" ? { role_template_id: roleTemplateId } : {}),
      });
      navigate(`/agents/${created.id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (companyId === null) return <div className="p-8 text-ink-muted">Loading…</div>;

  return (
    <form onSubmit={(e) => void submit(e)} className="p-8 max-w-xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-4">{t("agent.new.title")}</h1>

      <div className="mb-3">
        <label className="block text-xs text-ink-soft mb-1">{t("agent.new.fields.name")}</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full text-sm border border-surface-border rounded px-2 py-1"
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs text-ink-soft mb-1">{t("agent.new.fields.role")}</label>
        <select
          value={roleTemplateId}
          onChange={(e) => setRoleTemplateId(e.target.value)}
          className="w-full text-sm border border-surface-border rounded px-2 py-1 bg-surface"
        >
          <option value="">—</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="block text-xs text-ink-soft mb-1">
          {t("agent.new.fields.reportsTo")}
        </label>
        <select
          value={reportsTo}
          onChange={(e) => setReportsTo(e.target.value)}
          className="w-full text-sm border border-surface-border rounded px-2 py-1 bg-surface"
        >
          <option value="">—</option>
          {agents
            .filter((a) => a.status !== "terminated")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="block text-xs text-ink-soft mb-1">{t("agent.new.fields.mode")}</label>
        <div className="flex gap-3 text-sm">
          {(["supervised", "auto"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="radio"
                name="mode-new"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {t(`agent.config.mode.${m}`)}
            </label>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-xs text-ink-soft mb-1">{t("agent.location.label")}</label>
        <div className="flex gap-3 text-sm">
          {(["local", "remote"] as const).map((loc) => (
            <label key={loc} className="flex items-center gap-1">
              <input
                type="radio"
                name="location-new"
                checked={location === loc}
                onChange={() => setLocation(loc)}
              />
              {t(`agent.location.${loc}`)}
            </label>
          ))}
        </div>
        <p className="text-[10px] text-ink-soft mt-1">{t("agent.location.hint")}</p>
      </div>

      <div className="mb-3">
        <label className="block text-xs text-ink-soft mb-1">{t("agent.new.fields.persona")}</label>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="w-full text-sm border border-surface-border rounded px-2 py-1 h-32 font-mono"
        />
      </div>

      {error !== null && <p className="text-xs text-semantic-danger mb-3">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="text-sm px-4 py-1.5 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
        >
          {t("agent.new.submit")}
        </button>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm px-4 py-1.5 bg-surface-soft text-ink-muted rounded"
        >
          {t("agent.new.cancel")}
        </button>
      </div>
    </form>
  );
};
