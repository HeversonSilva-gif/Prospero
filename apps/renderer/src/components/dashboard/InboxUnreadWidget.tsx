import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useInboxStore } from "../../stores/inbox.js";

export const InboxUnreadWidget: FC = () => {
  const { t } = useTranslation();
  const items = useInboxStore((s) => s.items);
  const unread = useInboxStore((s) => s.unread);
  const lastUnread = items.find((i) => i.readAt === null) ?? null;

  return (
    <div className="bg-surface-card border border-surface-border rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-brand-dark">
          {t("dashboard.inboxUnread.title")}
        </h3>
        <Link to="/inbox" className="text-xs text-brand hover:underline">
          {t("dashboard.inboxUnread.viewAll")} →
        </Link>
      </div>
      {unread === 0 ? (
        <p className="text-xs text-ink-muted">{t("dashboard.inboxUnread.empty")}</p>
      ) : (
        <>
          <div className="text-3xl font-bold text-brand-dark">{unread}</div>
          <div className="text-xs text-ink-muted mt-0.5">{t("dashboard.inboxUnread.subtitle")}</div>
          {lastUnread !== null && (
            <p className="mt-3 text-xs text-ink truncate" title={lastUnread.title}>
              {t("dashboard.inboxUnread.latestLabel")}: {lastUnread.title}
            </p>
          )}
        </>
      )}
    </div>
  );
};
