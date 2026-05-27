// Async governance — V2 Tier 2.
// Public types consumed by main (validators with Zod live in apps/main) and
// renderer (re-exported via env.d.ts).

export type QuietWindow = {
  /** Day-of-week bitmask: 0=Sun .. 6=Sat */
  daysOfWeek: number[];
  /** Minutes since midnight (host local time), 0-1439. */
  startMinute: number;
  /** Minutes since midnight (host local time), 0-1439. If < startMinute, the
   *  window wraps past midnight (e.g. 22:00 -> 08:00). */
  endMinute: number;
};

export type QuietHoursSchedule = {
  windows: QuietWindow[];
};

export type PolicyConfig = {
  /** When true, read-only tools auto-approve across all projects. */
  autoApproveReadOnlyAcrossProjects: boolean;
  /** Auto-approve cost-approval requests below this cap (USD/day). Null = off. */
  autoApproveSpendUnderUsdPerDay: number | null;
  /** When true, in quiet hours the CEO decides fires instead of the human. */
  ceoCanDecideFires: boolean;
  /** When true, in quiet hours the CEO decides budget overruns instead of the human. */
  ceoCanDecideBudgetOverruns: boolean;
  /** How long an approval can sit in the human inbox before bouncing to CEO. */
  bouncedToCeoTtlHours: number;
};

export type GovernanceConfig = {
  quietHours: QuietHoursSchedule;
  policies: PolicyConfig;
};

export type PolicyVerdict =
  | { kind: "auto-approve"; reason: string }
  | { kind: "route"; relaxedFires: boolean; relaxedBudgets: boolean };

export type GovernanceResult =
  | { kind: "auto-approve"; reason: string }
  | { kind: "route"; relaxedFires: boolean; relaxedBudgets: boolean };

export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  quietHours: { windows: [] },
  policies: {
    autoApproveReadOnlyAcrossProjects: false,
    autoApproveSpendUnderUsdPerDay: null,
    ceoCanDecideFires: false,
    ceoCanDecideBudgetOverruns: false,
    bouncedToCeoTtlHours: 4,
  },
};
