import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { InboxItem } from "@prospero/shared";

// M14 PR-B — render branch for `trust_promotion_suggested` inbox items.
// The backend (M14 PR-A engine.ts) already wrote the title + preview text in
// Portuguese at creation time (e.g. "Promover X para Autônomo?"); we surface
// the Aprovar button that calls trust:approve-promotion.

interface Props {
  item: InboxItem;
  markRead: (id: string) => void;
}

export const TrustPromotionCard: FC<Props> = ({ item, markRead }) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (item.readAt !== null) {
    // Already resolved — nothing to do.
    return null;
  }

  const approve = async (): Promise<void> => {
    setError(null);
    setPending(true);
    try {
      await window.prospero.trust.approvePromotion({ inboxItemId: item.id });
      // Backend marks read + broadcasts — reflect immediately for instant feedback.
      markRead(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex gap-2 mt-2 items-center">
      <button
        type="button"
        onClick={() => void approve()}
        disabled={pending}
        className="text-xs px-3 py-1 bg-semantic-success text-white rounded font-semibold disabled:opacity-50"
      >
        {pending ? t("trust.promotionCard.approving") : t("trust.promotionCard.approve")}
      </button>
      {error !== null && (
        <span role="alert" className="text-xs text-semantic-danger">
          {error}
        </span>
      )}
    </div>
  );
};
