import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { TrustTier } from "@prospero/shared";

// M14 PR-B — Trust tier badge. Small text chip + color dot. Used in the
// agent list and the agent header. NO emojis (project rule
// `feedback_no_emojis`); tier semantics encoded via dot color + text.
//
// M14 PR-D — when `agentId` is supplied, the badge lazy-fetches the
// `TierEvaluation` on `onMouseEnter` and surfaces `blockedReason` (when
// present) inside the native `title` tooltip. Falls back to the static
// per-tier title text if no agentId or evaluation hasn't returned yet.

const TIER_DOT: Record<TrustTier, string> = {
  novato: "bg-ink-soft",
  confiavel: "bg-semantic-success",
  autonomo: "bg-brand",
};

interface Props {
  tier: TrustTier;
  agentId?: string;
}

export const TrustTierBadge: FC<Props> = ({ tier, agentId }) => {
  const { t } = useTranslation();
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const onHover = (): void => {
    if (fetched || agentId === undefined) return;
    setFetched(true);
    void window.prospero.trust.getEvaluation({ agentId }).then((ev) => {
      if (ev.blockedReason !== null) setBlockedReason(ev.blockedReason);
    });
  };

  const titleText =
    blockedReason !== null
      ? t("trust.badge.blockedPrefix", { reason: blockedReason })
      : t(`trust.badge.title.${tier}`);

  return (
    <span
      onMouseEnter={onHover}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted"
      title={titleText}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT[tier]}`} aria-hidden />
      {t(`trust.tier.${tier}`)}
    </span>
  );
};
