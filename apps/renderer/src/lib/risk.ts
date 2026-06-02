export type RiskKind = "money" | "publish" | "safe";

export type RiskInfo = { labelKey: string; classes: string };

// Risk shown on a decision: money (gated, irreversible) / publish (public) / safe.
export const riskInfo = (kind: RiskKind): RiskInfo => {
  switch (kind) {
    case "money":
      return { labelKey: "decisoes.risk.money", classes: "text-risk-money-fg bg-risk-money-bg" };
    case "publish":
      return { labelKey: "decisoes.risk.publish", classes: "text-risk-warn-fg bg-risk-warn-bg" };
    case "safe":
      return { labelKey: "decisoes.risk.safe", classes: "text-brand bg-brand-bg" };
  }
};
