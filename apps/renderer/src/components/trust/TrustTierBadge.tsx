import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { TrustTier } from "@prospero/shared";

// M14 PR-B — Trust tier badge. Small text chip + color dot. Used in the
// agent list and the agent header. NO emojis (project rule
// `feedback_no_emojis`); tier semantics encoded via dot color + text.

const TIER_DOT: Record<TrustTier, string> = {
  novato: "bg-ink-soft",
  confiavel: "bg-semantic-success",
  autonomo: "bg-brand",
};

interface Props {
  tier: TrustTier;
}

export const TrustTierBadge: FC<Props> = ({ tier }) => {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-surface-soft rounded text-ink-muted"
      title={t(`trust.badge.title.${tier}`)}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_DOT[tier]}`} aria-hidden />
      {t(`trust.tier.${tier}`)}
    </span>
  );
};
