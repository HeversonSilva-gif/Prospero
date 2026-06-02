import { type FC } from "react";
import { Check } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ONBOARDING_PHASES, type OnboardingPhase } from "../lib/onboarding.js";

// Progress indicator for the Nova-empresa wizard. Purely presentational — the
// active phase is derived upstream from company state, not stored here.
export const OnboardingStepper: FC<{ active: OnboardingPhase }> = ({ active }) => {
  const { t } = useTranslation();
  const activeIndex = ONBOARDING_PHASES.indexOf(active);

  return (
    <ol className="flex items-center gap-2 px-6 py-3 border-b border-surface-border bg-surface">
      {ONBOARDING_PHASES.map((phase, i) => {
        const done = i < activeIndex;
        const current = i === activeIndex;
        return (
          <li key={phase} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                current
                  ? "bg-brand text-brand-fg"
                  : done
                    ? "bg-brand-bg text-brand"
                    : "bg-surface-soft text-ink-soft border border-surface-border"
              }`}
            >
              {done ? <Check size={12} weight="bold" /> : i + 1}
            </span>
            <span className={`text-xs ${current ? "font-semibold text-ink" : "text-ink-muted"}`}>
              {t(`novaEmpresa.steps.${phase}`)}
            </span>
            {i < ONBOARDING_PHASES.length - 1 && (
              <span className="mx-1 h-px w-6 bg-surface-border" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default OnboardingStepper;
