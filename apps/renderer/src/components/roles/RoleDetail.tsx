import { type FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CAPABILITY_CATALOG, type RoleDetail as RoleDetailType } from "@prospero/shared";
import { useRolesStore } from "../../stores/roles.js";
import { CharterEditor } from "./CharterEditor.js";
import { RoleFormModal } from "./RoleFormModal.js";

type Props = {
  detail: RoleDetailType;
};

export const RoleDetail: FC<Props> = ({ detail }) => {
  const { t } = useTranslation();
  const charter = useRolesStore((s) => s.selectedCharter);
  const saveCharter = useRolesStore((s) => s.saveCharter);
  const remove = useRolesStore((s) => s.remove);
  const clone = useRolesStore((s) => s.clone);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const effective = [...detail.defaultCapabilities];
    if (!effective.includes("chat")) effective.push("chat");
    return effective
      .map((id) => CAPABILITY_CATALOG[id as keyof typeof CAPABILITY_CATALOG])
      .filter((s) => s !== undefined);
  }, [detail.defaultCapabilities]);

  const inUse = detail.agentsUsing.length > 0;

  const handleDelete = async (): Promise<void> => {
    if (!window.confirm(t("roles.confirmDelete", { name: detail.name }))) return;
    setError(null);
    try {
      await remove(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <header className="flex items-start gap-3 mb-4">
        {detail.icon !== null && <span className="text-3xl">{detail.icon}</span>}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-brand-dark">{detail.name}</h2>
            {detail.isSeedExample && (
              <span className="text-[10px] uppercase tracking-wide bg-surface-soft text-ink-muted px-1.5 py-0.5 rounded">
                {t("roles.seedBadge")}
              </span>
            )}
          </div>
          <p className="text-sm text-ink-muted mt-1">{detail.description}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs px-2.5 py-1 rounded border border-surface-border text-ink-muted"
          >
            {t("roles.edit")}
          </button>
          <button
            type="button"
            onClick={() => void clone(detail.id)}
            className="text-xs px-2.5 py-1 rounded border border-surface-border text-ink-muted"
          >
            {t("roles.clone")}
          </button>
          <button
            type="button"
            disabled={inUse}
            title={inUse ? t("roles.deleteInUse") : undefined}
            onClick={() => void handleDelete()}
            className="text-xs px-2.5 py-1 rounded border border-rose-300 text-rose-600 disabled:opacity-40"
          >
            {t("roles.delete")}
          </button>
        </div>
      </header>

      {error !== null && <p className="text-[11px] text-rose-600 mb-3">{error}</p>}

      <section className="mb-6">
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("roles.detail.defaultModel")}
        </h3>
        <code className="text-sm font-mono bg-surface-soft px-2 py-1 rounded inline-block">
          {detail.defaultModel}
        </code>
      </section>

      <section className="mb-6">
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("roles.detail.tools")}
        </h3>
        <div className="space-y-3">
          {grouped.map((capability) => (
            <div key={capability.id}>
              <div className="text-xs text-ink-muted mb-1.5">
                {t("roles.detail.capabilityGroup", { capability: capability.id })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {capability.tools.map((tool) => (
                  <span
                    key={tool}
                    className="text-[11px] font-mono bg-brand-bg text-brand-dark px-2 py-0.5 rounded"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("roles.charter.title")}
        </h3>
        <p className="text-[11px] text-ink-muted mb-2">{t("roles.charter.hint")}</p>
        <CharterEditor body={charter} onSave={(body) => saveCharter(detail.id, body)} />
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("roles.detail.agentsUsing")}
        </h3>
        {detail.agentsUsing.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("roles.detail.noAgents")}</p>
        ) : (
          <ul className="space-y-1">
            {detail.agentsUsing.map((a) => (
              <li key={a.id}>
                <Link to={`/agents/${a.id}`} className="text-sm text-brand hover:underline">
                  {a.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <RoleFormModal existing={detail} onClose={() => setEditing(false)} />}
    </div>
  );
};
