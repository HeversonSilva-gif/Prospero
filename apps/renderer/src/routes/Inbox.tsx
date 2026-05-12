import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { InboxItem, InboxKind, PermissionResolution } from "@dashboard-agent/shared";
import { useInboxStore } from "../stores/inbox.js";

const KIND_BORDER: Record<InboxKind, string> = {
  approval: "border-l-4 border-l-semantic-warning",
  completed: "border-l-4 border-l-semantic-success",
  suggestion: "border-l-4 border-l-brand",
  error: "border-l-4 border-l-semantic-danger",
  security_alert: "border-l-4 border-l-semantic-danger bg-semantic-danger/5",
};

type FilterKey = "all" | InboxKind;

const FILTERS: FilterKey[] = [
  "all",
  "approval",
  "completed",
  "suggestion",
  "error",
  "security_alert",
];

export const Inbox: FC = () => {
  const { t } = useTranslation();
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = filter === "all" ? items : items.filter((i) => i.kind === filter);

  const resolveApproval = async (item: InboxItem, allow: boolean) => {
    if (item.payloadJson === null) return;
    const payload = JSON.parse(item.payloadJson) as { toolUseId: string };
    const resolution: PermissionResolution = allow
      ? { behavior: "allow" }
      : { behavior: "deny", message: "User rejected via inbox" };
    await window.dashboardAgent.permissions.resolve(payload.toolUseId, resolution);
    await markRead(item.id);
  };

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-dark mb-4">{t("inbox.title")}</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            type="button"
            className={`text-xs px-2 py-1 rounded ${filter === f ? "bg-brand text-brand-fg" : "bg-surface-soft text-ink-muted"}`}
          >
            {t(`inbox.filter.${f}`)}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="text-ink-muted text-sm">{t("inbox.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <li
              key={item.id}
              className={`bg-surface-card rounded p-3 ${KIND_BORDER[item.kind]} ${item.readAt === null ? "" : "opacity-60"}`}
            >
              <div className="flex justify-between gap-3">
                <h3 className="text-sm font-semibold text-brand-dark">{item.title}</h3>
                <span className="text-[10px] text-ink-soft">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>
              {item.preview !== null && (
                <p className="text-xs text-ink-muted mt-1 break-words">{item.preview}</p>
              )}
              {item.kind === "approval" && item.requiresAction && item.readAt === null && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => void resolveApproval(item, true)}
                    type="button"
                    className="text-xs px-3 py-1 bg-semantic-success text-white rounded font-semibold"
                  >
                    {t("inbox.approve")}
                  </button>
                  <button
                    onClick={() => void resolveApproval(item, false)}
                    type="button"
                    className="text-xs px-3 py-1 bg-semantic-danger text-white rounded font-semibold"
                  >
                    {t("inbox.reject")}
                  </button>
                </div>
              )}
              {item.readAt === null && item.requiresAction === false && (
                <button
                  onClick={() => void markRead(item.id)}
                  type="button"
                  className="text-[10px] text-ink-muted hover:underline mt-2"
                >
                  {t("inbox.markRead")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
