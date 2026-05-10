import type { FC } from "react";
import type { IssueComment, Agent } from "@dashboard-agent/shared";

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
          <div className="text-ink-soft mb-1">
            <b className="text-brand-dark">{senderName}</b> ({c.senderKind}) · {fmtAgo(c.createdAt)}
          </div>
          <div className="bg-surface-soft px-3 py-2 rounded whitespace-pre-wrap">{c.content}</div>
        </div>
      );
    })}
  </div>
);
