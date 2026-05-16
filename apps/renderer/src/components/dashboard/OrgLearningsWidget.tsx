import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Skill, Memory } from "@prospero/shared";

interface Props {
  companyId: string;
}

// Dashboard card: what the company has learned — top shared skills + recent
// goal retrospectives. M11 org-learning surface.
export const OrgLearningsWidget: FC<Props> = ({ companyId }) => {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [retros, setRetros] = useState<Memory[]>([]);

  useEffect(() => {
    void (async () => {
      const out = await window.prospero.learning.orgLearnings(companyId);
      setSkills(out.topSkills);
      setRetros(out.recentRetrospectives);
    })();
  }, [companyId]);

  const empty = skills.length === 0 && retros.length === 0;

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <h3 className="text-sm font-semibold text-brand-dark mb-3">
        {t("dashboard.orgLearnings.title")}
      </h3>
      {empty ? (
        <p className="text-xs text-ink-muted">{t("dashboard.orgLearnings.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {skills.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
                {t("dashboard.orgLearnings.skills")}
              </p>
              <ul className="flex flex-col gap-0.5">
                {skills.map((s) => (
                  <li key={s.id} className="text-xs text-ink-muted">
                    <span className="text-ink">{s.name}</span> · {s.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {retros.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft mb-1">
                {t("dashboard.orgLearnings.retrospectives")}
              </p>
              <ul className="flex flex-col gap-1">
                {retros.map((m) => (
                  <li key={m.id} className="text-xs text-ink-muted">
                    {m.body}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
