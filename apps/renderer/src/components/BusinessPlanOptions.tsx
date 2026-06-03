import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Star, ChartBar, Lightning, Users, CurrencyDollar } from "@phosphor-icons/react";
import type { BusinessPlanOption } from "@prospero/shared";
import { useBusinessPlanStore } from "../stores/businessPlan.js";
import { signalToPercent, signalLabel } from "./businessPlanOptions.helpers.js";

// ── Signal meter ────────────────────────────────────────────────────────────

type SignalMeterProps = {
  icon: React.ReactNode;
  label: string;
  score: number;
  displayValue: string;
};

const SignalMeter: FC<SignalMeterProps> = ({ icon, label, score, displayValue }) => (
  <div className="flex items-center gap-2 py-1.5 text-[11px] border-b border-surface-soft last:border-b-0">
    <span className="w-4 flex items-center justify-center flex-shrink-0 text-ink-soft" aria-hidden>
      {icon}
    </span>
    <span className="w-[72px] flex-shrink-0 text-ink-soft uppercase tracking-[.05em] text-[10px] font-medium">
      {label}
    </span>
    <span className="text-ink font-medium flex-1">
      {displayValue}
      <div
        className="mt-1 h-1.5 rounded-full bg-surface-soft overflow-hidden max-w-[140px]"
        role="presentation"
      >
        <div className="h-full bg-brand rounded-full" style={{ width: signalToPercent(score) }} />
      </div>
    </span>
  </div>
);

// ── Revenue row (no bar, mono font) ──────────────────────────────────────────

type RevenueRowProps = {
  label: string;
  value: string;
};

const RevenueRow: FC<RevenueRowProps> = ({ label, value }) => (
  <div className="flex items-center gap-2 py-1.5 text-[11px]">
    <span className="w-4 flex items-center justify-center flex-shrink-0 text-ink-soft" aria-hidden>
      <CurrencyDollar size={14} />
    </span>
    <span className="w-[72px] flex-shrink-0 text-ink-soft uppercase tracking-[.05em] text-[10px] font-medium">
      {label}
    </span>
    <span className="font-mono text-brand font-medium">{value}</span>
  </div>
);

// ── Option card ───────────────────────────────────────────────────────────────

type OptionCardProps = {
  option: BusinessPlanOption;
  index: number;
  position: number; // 1-based display number
  onChoose: (index: number) => void;
};

const OptionCard: FC<OptionCardProps> = ({ option, index, position, onChoose }) => {
  const { t } = useTranslation();
  const isRec = option.recommended;

  return (
    <button
      type="button"
      onClick={() => onChoose(index)}
      className={[
        "flex-1 min-w-[225px] text-left bg-surface-card border rounded-2xl p-[17px] cursor-pointer transition-all duration-150 flex flex-col gap-3",
        "hover:-translate-y-0.5 hover:shadow-[0_10px_26px_-12px_rgba(15,118,110,.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        isRec
          ? "border-brand shadow-[0_8px_24px_-10px_rgba(15,118,110,.28)]"
          : "border-surface-border hover:border-brand",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={t("businessPlan.options.chooseAria", { name: option.identity.name })}
    >
      {/* Badge or position label */}
      {isRec ? (
        <span className="inline-flex items-center gap-1.5 self-start text-[10.5px] font-bold tracking-[.04em] text-brand-fg bg-brand px-2.5 py-1 rounded-full">
          <Star size={11} weight="fill" aria-hidden />
          {t("businessPlan.options.recommended")}
        </span>
      ) : (
        <span className="text-[10.5px] font-semibold text-ink-soft uppercase tracking-[.06em]">
          {t("businessPlan.options.optionN", { n: position })}
        </span>
      )}

      {/* Name + concept */}
      <div>
        <div className="text-base font-semibold text-ink tracking-[-0.01em]">
          {option.identity.name}
        </div>
        <div className="text-[12px] text-ink-muted leading-relaxed mt-0.5">{option.concept}</div>
      </div>

      {/* Signals */}
      <div className="border-t border-surface-soft pt-1 flex flex-col">
        <SignalMeter
          icon={<ChartBar size={14} />}
          label={t("businessPlan.options.signals.market")}
          score={option.signals.market}
          displayValue={signalLabel("market", option.signals.market)}
        />
        <SignalMeter
          icon={<Lightning size={14} />}
          label={t("businessPlan.options.signals.virality")}
          score={option.signals.virality}
          displayValue={signalLabel("virality", option.signals.virality)}
        />
        <SignalMeter
          icon={<Users size={14} />}
          label={t("businessPlan.options.signals.community")}
          score={option.signals.community}
          displayValue={signalLabel("community", option.signals.community)}
        />
        <RevenueRow
          label={t("businessPlan.options.signals.revenue12m")}
          value={option.signals.revenue12m}
        />
      </div>

      {/* Why recommended (only on the recommended card) */}
      {isRec && option.whyRecommended.trim() !== "" && (
        <div className="bg-brand-bg rounded-lg px-3 py-2.5 text-[11.5px] text-[#0c5d56] leading-relaxed">
          <span className="font-semibold">{t("businessPlan.options.whyPrefix")}</span>{" "}
          {option.whyRecommended}
        </div>
      )}

      {/* CTA button */}
      <div
        className={[
          "mt-auto text-[13px] font-semibold py-2.5 rounded-lg text-center",
          isRec ? "bg-brand text-brand-fg" : "text-brand border border-surface-border",
        ].join(" ")}
      >
        {t("businessPlan.options.seePlan")}
      </div>
    </button>
  );
};

// ── Main chooser component ────────────────────────────────────────────────────

type Props = {
  options: BusinessPlanOption[];
};

export const BusinessPlanOptions: FC<Props> = ({ options }) => {
  const { t } = useTranslation();
  const chooseOption = useBusinessPlanStore((s) => s.chooseOption);

  // Determine display positions: the recommended card always shows "Recomendado",
  // non-recommended cards are numbered 2, 3, … (skipping the recommended slot).
  let nonRecCounter = 1;
  const positions = options.map((o) => {
    if (o.recommended) return 1; // label is "Recomendado", not a number
    nonRecCounter++;
    return nonRecCounter;
  });

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Intro */}
      <div>
        <h2 className="text-[23px] font-semibold text-ink tracking-[-0.02em] m-0">
          {t("businessPlan.options.title")}
        </h2>
        <div className="flex gap-2.5 items-start mt-3 text-[13px] text-ink-muted leading-relaxed">
          <span
            className="w-[26px] h-[26px] rounded-lg bg-brand text-brand-fg flex items-center justify-center text-[10px] font-bold flex-shrink-0"
            aria-hidden
          >
            CE
          </span>
          <div>{t("businessPlan.options.ceoPitch")}</div>
        </div>
      </div>

      {/* Option cards */}
      <div className="flex gap-3.5 items-stretch flex-wrap">
        {options.map((opt, i) => (
          <OptionCard
            key={i}
            option={opt}
            index={i}
            position={positions[i] ?? i + 1}
            onChoose={chooseOption}
          />
        ))}
      </div>

      {/* Footer disclaimer */}
      <p className="text-[11px] text-ink-soft text-center mt-1">
        {t("businessPlan.options.disclaimer")}
      </p>
    </div>
  );
};
