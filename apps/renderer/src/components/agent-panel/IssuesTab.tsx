import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Issue, IssueStatus } from "@prospero/shared";

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

  if (loading) {
    return <div className="p-4 text-xs text-ink-muted">…</div>;
  }
  if (issues.length === 0) {
    return <div className="p-4 text-xs text-ink-muted italic">{t("agent.issues.empty")}</div>;
  }
  return (
    <ul className="p-3 space-y-2">
      {issues.map((i) => (
        <li
          key={i.id}
          className="flex items-center gap-2 text-xs hover:bg-surface-soft rounded px-2 py-1.5"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[i.status]}`} />
          <span className="flex-1 truncate">{i.title}</span>
          <span className="text-[10px] text-ink-soft uppercase">{i.status}</span>
        </li>
      ))}
    </ul>
  );
};
