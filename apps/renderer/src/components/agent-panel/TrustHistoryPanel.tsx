import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { TrustEvent, TrustEventKind } from "@prospero/shared";

// M14 PR-B — read-only history of the agent's trust ladder transitions.
// Consumes window.prospero.trust.getHistory({agentId}); loading / empty /
// error states are explicit. The list is already returned in
// reverse-chronological order (TrustEventsRepository ORDER BY created_at DESC,
// rowid DESC — M14 PR-A).

const KIND_DOT: Record<TrustEventKind, string> = {
  promoted: "bg-semantic-success",
  demoted: "bg-semantic-danger",
  promotion_suggested: "bg-brand",
};

interface Props {
  agentId: string;
}

export const TrustHistoryPanel: FC<Props> = ({ agentId }) => {
  const { t } = useTranslation();
  const [events, setEvents] = useState<TrustEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.prospero.trust.getHistory({ agentId });
        setEvents(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [agentId]);

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">{t("trust.history.title")}</h2>
      <p className="text-xs text-ink-muted mb-3">{t("trust.history.subtitle")}</p>

      {error !== null && (
        <p role="alert" className="text-xs text-semantic-danger">
          {error}
        </p>
      )}
      {error === null && events === null && (
        <p className="text-xs text-ink-muted">{t("trust.history.loading")}</p>
      )}
      {error === null && events !== null && events.length === 0 && (
        <p className="text-xs text-ink-muted">{t("trust.history.empty")}</p>
      )}
      {error === null && events !== null && events.length > 0 && (
        <ul className="space-y-2 text-xs">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-start gap-2 border-t border-surface-border pt-2 first:border-t-0 first:pt-0"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${KIND_DOT[e.kind]}`}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className="text-ink">
                  <span className="font-semibold">{t(`trust.history.kind.${e.kind}`)}</span>
                  {": "}
                  <span className="text-ink-muted">
                    {t(`trust.tier.${e.fromTier}`)} → {t(`trust.tier.${e.toTier}`)}
                  </span>
                </p>
                <p className="text-ink-muted break-words">{e.reason}</p>
              </div>
              <span className="text-[10px] text-ink-soft shrink-0">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
