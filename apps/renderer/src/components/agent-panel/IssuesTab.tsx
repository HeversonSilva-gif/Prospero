import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Issue, IssueStatus } from "@prospero/shared";
import { Section, EmptyState, LoadingState } from "../ui/index.js";

type Props = { agentId: string; companyId: string };

const STATUS_COLOR: Record<IssueStatus, string> = {
  backlog: "bg-ink-soft",
  todo: "bg-brand",
  doing: "bg-semantic-warning",
  review: "bg-semantic-info",
  done: "bg-semantic-success",
  cancelled: "bg-ink-soft",
};

export const IssuesTab: FC<Props> = ({ agentId, companyId }) => {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const list = await window.prospero.issues.list({ companyId, assigneeId: agentId });
      if (!cancelled) {
        setIssues(list);
        setLoading(false);
      }
    })();
    const off = window.prospero.issues.onChanged(() => {
      void (async () => {
        const list = await window.prospero.issues.list({ companyId, assigneeId: agentId });
        if (!cancelled) setIssues(list);
      })();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [agentId, companyId]);

  return (
    <div className="p-6">
      <Section title={t("agent.studio.issues.title")}>
        {loading ? (
          <LoadingState />
        ) : issues.length === 0 ? (
          <EmptyState message={t("agent.issues.empty")} />
        ) : (
          <ul className="divide-y divide-border-soft rounded-md border border-border-soft overflow-hidden">
            {issues.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-3 px-4 py-3 text-xs bg-surface hover:bg-surface-soft transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[i.status]}`} />
                <span className="flex-1 truncate text-ink">{i.title}</span>
                <span className="shrink-0 rounded-sm bg-surface-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-soft">
                  {i.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
};
