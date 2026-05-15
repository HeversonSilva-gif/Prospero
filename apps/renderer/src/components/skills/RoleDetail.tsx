import { type FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SKILL_CATALOG, type RoleDetail as RoleDetailType } from "@prospero/shared";

type Props = {
  detail: RoleDetailType;
};

export const RoleDetail: FC<Props> = ({ detail }) => {
  const { t } = useTranslation();

  // Group resolvedTools back by skill so the UI shows "shell → Bash" etc.
  // The defaultSkills array tells us which skills are active; chat is auto-added
  // by the resolver, so include it explicitly.
  const grouped = useMemo(() => {
    const effective = [...detail.defaultSkills];
    if (!effective.includes("chat")) effective.push("chat");
    return effective
      .map((id) => SKILL_CATALOG[id as keyof typeof SKILL_CATALOG])
      .filter((s) => s !== undefined);
  }, [detail.defaultSkills]);

  return (
    <div className="p-6 max-w-3xl">
      <header className="flex items-center gap-3 mb-4">
        {detail.icon !== null && <span className="text-3xl">{detail.icon}</span>}
        <div>
          <h2 className="text-xl font-bold text-brand-dark">{detail.name}</h2>
          <p className="text-sm text-ink-muted mt-1">{detail.description}</p>
        </div>
      </header>

      <section className="mb-6">
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("skills.detail.defaultModel")}
        </h3>
        <code className="text-sm font-mono bg-surface-soft px-2 py-1 rounded inline-block">
          {detail.defaultModel}
        </code>
      </section>

      <section className="mb-6">
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("skills.detail.tools")}
        </h3>
        <div className="space-y-3">
          {grouped.map((skill) => (
            <div key={skill.id}>
              <div className="text-xs text-ink-muted mb-1.5">
                {t("skills.detail.skillsGroup", { skill: skill.id })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {skill.tools.map((tool) => (
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

      <section>
        <h3 className="text-xs uppercase tracking-wide text-ink-soft mb-2 font-semibold">
          {t("skills.detail.agentsUsing")}
        </h3>
        {detail.agentsUsing.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("skills.detail.noAgents")}</p>
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
    </div>
  );
};
