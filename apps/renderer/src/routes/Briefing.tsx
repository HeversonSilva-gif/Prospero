import { useEffect, useState, type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBriefingStore } from "../stores/briefing.js";
import { useCompaniesStore } from "../stores/companies.js";
import { formatCents } from "../lib/costs/formatCents.js";
import type { BriefingItem } from "@prospero/shared";

// M14 PR-C — Vitrine Matinal. Triage page: "Precisa de você" dominates the
// top, the smaller buckets live in a colapsável strip below, cost as a footer.
// Renders nothing until a company is active; reloads when the active company
// changes.

const ItemRow: FC<{ item: BriefingItem; onClick?: () => void }> = ({ item, onClick }) => (
  <Link
    to={item.route}
    onClick={onClick}
    className="block px-3 py-2 rounded bg-surface-soft hover:bg-surface-border border border-surface-border"
  >
    <p className="text-sm font-semibold text-ink truncate">{item.label}</p>
    {item.detail !== "" && <p className="text-xs text-ink-muted truncate">{item.detail}</p>}
    {item.agentName !== null && (
      <p className="text-[10px] text-ink-soft mt-0.5">{item.agentName}</p>
    )}
  </Link>
);

export const Briefing: FC = () => {
  const { t } = useTranslation();
  const activeCompanyId = useCompaniesStore((s) => s.activeId);
  const briefing = useBriefingStore((s) => s.briefing);
  const loading = useBriefingStore((s) => s.loading);
  const error = useBriefingStore((s) => s.error);
  const load = useBriefingStore((s) => s.load);
  const markReviewed = useBriefingStore((s) => s.markReviewed);
  const [othersExpanded, setOthersExpanded] = useState(false);

  useEffect(() => {
    if (activeCompanyId !== null) void load(activeCompanyId);
  }, [activeCompanyId, load]);

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
    <div className="p-8 max-w-3xl space-y-6">
      {/* Headline */}
      <header>
        <h1 className="text-2xl font-bold text-brand-dark">{t("briefing.title")}</h1>
        <p className="mt-1 text-sm text-ink">{briefing.headline}</p>
      </header>

      {/* Precisa de você — always at top */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-brand-dark">
            {t("briefing.needsYou")} ({briefing.needsYou.length})
          </h2>
          <button
            type="button"
            onClick={() => void markReviewed(activeCompanyId)}
            className="text-xs px-2 py-1 bg-surface-soft text-ink-muted rounded hover:bg-surface-border"
          >
            {t("briefing.markReviewed")}
          </button>
        </div>
        {briefing.needsYou.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("briefing.needsYouEmpty")}</p>
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
      <section>
        <button
          type="button"
          onClick={() => setOthersExpanded((v) => !v)}
          className="text-xs text-ink-muted hover:text-ink"
        >
          {othersExpanded
            ? t("briefing.othersHide")
            : t("briefing.othersShow", { count: otherCount })}
        </button>
        {othersExpanded && (
          <div className="mt-3 space-y-4">
            {briefing.verified.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-semantic-success mb-1">
                  {t("briefing.verified")} ({briefing.verified.length})
                </h3>
                <ul className="space-y-1">
                  {briefing.verified.map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {briefing.failed.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-semantic-danger mb-1">
                  {t("briefing.failed")} ({briefing.failed.length})
                </h3>
                <ul className="space-y-1">
                  {briefing.failed.map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {briefing.inProgress.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-brand mb-1">
                  {t("briefing.inProgress")} ({briefing.inProgress.length})
                </h3>
                <ul className="space-y-1">
                  {briefing.inProgress.map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {briefing.learned.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-ink mb-1">
                  {t("briefing.learned")} ({briefing.learned.length})
                </h3>
                <ul className="space-y-1">
                  {briefing.learned.map((item) => (
                    <li key={item.id}>
                      <ItemRow item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Cost footer */}
      <footer className="text-xs text-ink-muted pt-4 border-t border-surface-border">
        {t("briefing.costFooter", { cost: formatCents(briefing.costCents) })}
      </footer>
    </div>
  );
};
