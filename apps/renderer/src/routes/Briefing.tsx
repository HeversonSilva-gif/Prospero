import { useEffect, useState, type FC, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBriefingStore } from "../stores/briefing.js";
import { useCompaniesStore } from "../stores/companies.js";
import { formatCents } from "../lib/costs/formatCents.js";
import type { BriefingItem } from "@prospero/shared";

// M14 PR-C — Vitrine Matinal. Triage page: "Precisa de você" dominates the
// top, the smaller buckets live in a colapsável strip below, cost as a footer.
// M14 PR-D — polish: stronger visual hierarchy, SVG dots per bucket, tighter
// loading/empty/error states. Subscribes to INBOX_UPDATE so new items appear
// without manual refresh.

type BucketColor = "warning" | "success" | "danger" | "brand" | "ink";

const DOT: Record<BucketColor, string> = {
  warning: "bg-semantic-warning",
  success: "bg-semantic-success",
  danger: "bg-semantic-danger",
  brand: "bg-brand",
  ink: "bg-ink-soft",
};

const ItemRow: FC<{ item: BriefingItem }> = ({ item }) => (
  <Link
    to={item.route}
    className="block px-3 py-2 rounded border border-surface-border bg-surface-card hover:border-brand transition-colors"
  >
    <p className="text-sm font-medium text-ink truncate">{item.label}</p>
    {item.detail !== "" && <p className="text-xs text-ink-muted truncate mt-0.5">{item.detail}</p>}
    {item.agentName !== null && (
      <p className="text-[10px] text-ink-soft mt-0.5">{item.agentName}</p>
    )}
  </Link>
);

const BucketHeader: FC<{
  color: BucketColor;
  label: string;
  count: number;
  right?: ReactNode;
}> = ({ color, label, count, right }) => (
  <div className="flex items-center justify-between mb-2">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
      <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[color]}`} aria-hidden />
      <span>{label}</span>
      <span className="text-xs text-ink-muted tabular-nums">({count})</span>
    </h3>
    {right !== undefined && <div>{right}</div>}
  </div>
);

const SubBucket: FC<{
  color: BucketColor;
  label: string;
  items: BriefingItem[];
}> = ({ color, label, items }) => {
  if (items.length === 0) return null;
  return (
    <section>
      <BucketHeader color={color} label={label} count={items.length} />
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <ItemRow item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
};

export const Briefing: FC = () => {
  const { t } = useTranslation();
  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const briefing = useBriefingStore((s) => s.briefing);
  const loading = useBriefingStore((s) => s.loading);
  const error = useBriefingStore((s) => s.error);
  const load = useBriefingStore((s) => s.load);
  const markReviewed = useBriefingStore((s) => s.markReviewed);
  const subscribeInbox = useBriefingStore((s) => s.subscribeInbox);
  const [othersExpanded, setOthersExpanded] = useState(false);

  useEffect(() => {
    if (activeCompanyId === null) return;
    void load(activeCompanyId);
    const off = subscribeInbox(activeCompanyId);
    return off;
  }, [activeCompanyId, load, subscribeInbox]);

  if (activeCompanyId === null) {
    return (
      <div className="p-8">
        <p className="text-sm text-ink-muted">{t("briefing.noCompany")}</p>
      </div>
    );
  }

  if (loading && briefing === null) {
    return (
      <div className="p-8">
        <p className="text-sm text-ink-muted">{t("briefing.loading")}</p>
      </div>
    );
  }

  if (error !== null && briefing === null) {
    return (
      <div className="p-8">
        <p role="alert" className="text-sm text-semantic-danger">
          {error}
        </p>
      </div>
    );
  }

  if (briefing === null) return null;

  const otherCount =
    briefing.verified.length +
    briefing.failed.length +
    briefing.inProgress.length +
    briefing.learned.length;

  return (
    <div className="p-8 max-w-3xl space-y-8">
      {/* Headline */}
      <header>
        <h1 className="text-2xl font-bold text-brand-dark">{t("briefing.title")}</h1>
        <p className="mt-2 text-base text-ink leading-relaxed italic">{briefing.headline}</p>
      </header>

      {/* Precisa de você — dominant, warning-tinted */}
      <section className="-mx-4 px-4 py-4 rounded-lg border-l-4 border-l-semantic-warning bg-semantic-warning-bg/30">
        <BucketHeader
          color="warning"
          label={t("briefing.needsYou")}
          count={briefing.needsYou.length}
          right={
            <button
              type="button"
              onClick={() => void markReviewed(activeCompanyId)}
              className="text-xs px-2.5 py-1 bg-surface-card text-ink-muted rounded border border-surface-border hover:border-brand"
            >
              {t("briefing.markReviewed")}
            </button>
          }
        />
        {briefing.needsYou.length === 0 ? (
          <p className="text-sm text-ink-muted italic">{t("briefing.needsYouEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {briefing.needsYou.map((item) => (
              <li key={item.id}>
                <ItemRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Other buckets — colapsável */}
      {otherCount > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setOthersExpanded((v) => !v)}
            className="text-xs text-ink-muted hover:text-ink font-medium"
          >
            {othersExpanded
              ? t("briefing.othersHide")
              : t("briefing.othersShow", { count: otherCount })}
          </button>
          {othersExpanded && (
            <div className="mt-4 space-y-5">
              <SubBucket color="success" label={t("briefing.verified")} items={briefing.verified} />
              <SubBucket color="danger" label={t("briefing.failed")} items={briefing.failed} />
              <SubBucket
                color="brand"
                label={t("briefing.inProgress")}
                items={briefing.inProgress}
              />
              <SubBucket color="ink" label={t("briefing.learned")} items={briefing.learned} />
            </div>
          )}
        </section>
      )}

      {/* Cost footer */}
      <footer className="text-xs text-ink-muted pt-4 border-t border-surface-border">
        {t("briefing.costFooter", { cost: formatCents(briefing.costCents) })}
      </footer>
    </div>
  );
};
