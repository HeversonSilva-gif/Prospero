import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { IssueComment, Agent } from "@prospero/shared";

type Props = { comments: IssueComment[]; agentMap: Map<string, Agent> };

const fmtAgo = (ts: number): string => {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
};

const SenderBadge: FC<{
  comment: IssueComment;
  agentMap: Map<string, Agent>;
}> = ({ comment, agentMap }) => {
  const { t } = useTranslation();
  if (comment.senderKind === "user") {
    return (
      <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-brand text-brand-fg">
        {t("issues.detail.commentBadge.user")}
      </span>
    );
  }
  const agent = comment.senderId !== null ? agentMap.get(comment.senderId) : undefined;
  const isCeo = agent?.templateId === "ceo" || agent?.role === "ceo";
  if (isCeo) {
    return (
      <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-brand-bg text-brand">
        {t("issues.detail.commentBadge.ceo")}
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-surface-soft text-ink-muted">
      {agent?.name ?? t("issues.detail.commentBadge.agent")}
    </span>
  );
};

export const IssueCommentsList: FC<Props> = ({ comments, agentMap }) => (
  <div className="space-y-3">
    {comments.map((c) => {
      const senderName =
        c.senderKind === "user"
          ? "You"
          : c.senderId !== null
            ? (agentMap.get(c.senderId)?.name ?? "Agent")
            : "System";
      return (
        <div key={c.id} className="text-xs">
          <div className="text-ink-soft mb-1 flex items-center gap-2">
            <SenderBadge comment={c} agentMap={agentMap} />
            <b className="text-brand-dark">{senderName}</b>
            <span>· {fmtAgo(c.createdAt)}</span>
          </div>
          <div className="bg-surface-soft px-3 py-2 rounded whitespace-pre-wrap">{c.content}</div>
        </div>
      );
    })}
  </div>
);
