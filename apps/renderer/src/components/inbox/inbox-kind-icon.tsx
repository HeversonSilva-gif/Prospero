import type { FC } from "react";
import type { InboxKind } from "@prospero/shared";
import {
  ShieldCheck,
  CheckCircle,
  Lightbulb,
  WarningCircle,
  ShieldWarning,
  Flag,
  Play,
  UsersThree,
  Storefront,
  CurrencyDollar,
  SealQuestion,
  TrendUp,
  Wallet,
  Sparkle,
  ChatCircle,
  Clock,
  Brain,
  ClipboardText,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

const ICON: Record<InboxKind, PhosphorIcon> = {
  approval: ShieldCheck,
  completed: CheckCircle,
  suggestion: Lightbulb,
  error: WarningCircle,
  security_alert: ShieldWarning,
  security_zone_blocked: ShieldWarning,
  goal_proposed: Flag,
  goal_executing: Play,
  goal_error: WarningCircle,
  agent_unresponsive: WarningCircle,
  skill_candidate_pending: Sparkle,
  skill_promotion_requested: Sparkle,
  skill_consolidation_proposed: Sparkle,
  goal_retrospective_ready: ClipboardText,
  memory_review_needed: Brain,
  org_proposed: UsersThree,
  budget_warning: Wallet,
  verification_failed: SealQuestion,
  verification_review: SealQuestion,
  trust_promotion_suggested: TrendUp,
  auto_mode_expired: Clock,
  manager_request: ChatCircle,
  ceo_decision: CheckCircle,
  business_proposed: Storefront,
  sale: CurrencyDollar,
};

export const InboxKindIcon: FC<{ kind: InboxKind; className?: string }> = ({ kind, className }) => {
  const Cmp = ICON[kind] ?? ChatCircle;
  return <Cmp className={className} aria-hidden={true} />;
};
