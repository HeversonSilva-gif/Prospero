import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChartBar, Lightning, Users, CurrencyDollar, X as XIcon } from "@phosphor-icons/react";
import { isCeoAgent, type BusinessPlan, type BusinessPlanOption } from "@prospero/shared";
import { useBusinessPlanStore } from "../stores/businessPlan.js";
import { useAgentsStore } from "../stores/agents.js";
import {
  resolveChosenOption,
  formatChargeItem,
  marketingChips,
} from "./businessPlanReview.helpers.js";
import { signalToPercent } from "./businessPlanOptions.helpers.js";

// ── Shared primitives ─────────────────────────────────────────────────────────

const SectionLabel: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10.5px] font-semibold uppercase tracking-[.11em] text-ink-soft mb-2">
    {children}
  </div>
);

const Card: FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => (
  <div
    className={`bg-surface-card border border-surface-border rounded-[13px] p-[16px_18px] ${className}`}
  >
    {children}
  </div>
);

// ── Signal card (for the options flow) ───────────────────────────────────────

type SignalCardProps = {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
};

const SignalCard: FC<SignalCardProps> = ({ icon, label, children }) => (
  <Card className="flex-1 min-w-[200px]">
    <SectionLabel>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-ink-soft" aria-hidden>
          {icon}
        </span>
        {label}
      </span>
    </SectionLabel>
    <div className="text-[13px] text-ink leading-[1.55]">{children}</div>
  </Card>
);

// ── Signal meter bar ──────────────────────────────────────────────────────────

const MeterBar: FC<{ score: number }> = ({ score }) => (
  <div
    className="mt-1.5 h-1.5 rounded-full bg-surface-soft overflow-hidden max-w-[160px]"
    role="presentation"
  >
    <div className="h-full bg-brand rounded-full" style={{ width: signalToPercent(score) }} />
  </div>
);

// ── Projection row ────────────────────────────────────────────────────────────

const ProjectionRow: FC<{ label: string; value: string; isLast?: boolean }> = ({
  label,
  value,
  isLast = false,
}) => (
  <div
    className={`flex justify-between items-center py-2 text-[12.5px] ${isLast ? "" : "border-b border-surface-soft"}`}
  >
    <span className="text-ink-muted">{label}</span>
    <span className="font-mono font-semibold text-brand">{value}</span>
  </div>
);

// ── Marketing chip ────────────────────────────────────────────────────────────

const Chip: FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex px-2.5 py-1 rounded-full bg-brand-bg text-[11px] font-medium text-[#0c5d56] border border-brand/20">
    {children}
  </span>
);

// ── Dropped idea row ──────────────────────────────────────────────────────────

const DroppedRow: FC<{ idea: string; reason: string }> = ({ idea, reason }) => (
  <div className="flex gap-2 items-start py-1 text-[12.5px] text-ink-muted">
    <XIcon size={14} className="text-[#c0726a] mt-0.5 flex-shrink-0" aria-hidden />
    <div>
      <span className="font-semibold text-ink">{idea}</span>
      {reason.trim() !== "" && <span> — {reason}</span>}
    </div>
  </div>
);

// ── Enriched plan view (options flow — chosenOption !== null) ─────────────────

type EnrichedPlanProps = {
  option: BusinessPlanOption;
  onBackToOptions: () => void;
  onRequestAdjustments: () => void;
  onApprove: () => void;
  submitting: boolean;
  approveLabel: string;
  adjustLabel: string;
};

const EnrichedPlanView: FC<EnrichedPlanProps> = ({
  option,
  onBackToOptions,
  onRequestAdjustments,
  onApprove,
  submitting,
  approveLabel,
  adjustLabel,
}) => {
  const { t } = useTranslation();
  const chips = marketingChips(option.marketing.tactics);

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-[640px] mx-auto flex flex-col gap-4">
          {/* Back link + title */}
          <div>
            <button
              type="button"
              onClick={onBackToOptions}
              className="text-[12px] text-ink-muted hover:text-brand transition-colors mb-3 inline-flex items-center gap-1"
            >
              {t("businessPlan.review.backToOptions")}
            </button>
            <h2 className="text-[23px] font-semibold text-ink tracking-[-0.02em] m-0 leading-tight">
              {option.identity.name}{" "}
              <span className="font-mono text-[13px] text-brand font-normal">
                {option.identity.proposedXHandle}
              </span>
            </h2>
          </div>

          {/* O negócio */}
          <Card className="border-[#CFE6DD]">
            <SectionLabel>{t("businessPlan.review.concept")}</SectionLabel>
            <p className="text-[13px] text-ink leading-[1.55] m-0">{option.concept}</p>
          </Card>

          {/* Signal cards — 2-up grid (market + virality) */}
          <div className="flex gap-3.5 flex-wrap">
            <SignalCard
              icon={<ChartBar size={14} />}
              label={t("businessPlan.review.signals.market")}
            >
              {option.signals.market >= 80
                ? "Grande"
                : option.signals.market >= 55
                  ? "Médio-grande"
                  : "Médio"}
              {". "}
              <MeterBar score={option.signals.market} />
            </SignalCard>

            <SignalCard
              icon={<Lightning size={14} />}
              label={t("businessPlan.review.signals.virality")}
            >
              {option.signals.virality >= 75
                ? "Alto"
                : option.signals.virality >= 55
                  ? "Médio-alto"
                  : "Médio"}
              {". "}
              <MeterBar score={option.signals.virality} />
            </SignalCard>
          </div>

          {/* Signal cards — community + revenue projection */}
          <div className="flex gap-3.5 flex-wrap">
            <SignalCard
              icon={<Users size={14} />}
              label={t("businessPlan.review.signals.community")}
            >
              {option.signals.community >= 88
                ? "Muito forte"
                : option.signals.community >= 75
                  ? "Forte"
                  : option.signals.community >= 55
                    ? "Média"
                    : "Fraca"}
              {". "}
              <MeterBar score={option.signals.community} />
            </SignalCard>

            <Card className="flex-1 min-w-[200px]">
              <SectionLabel>
                <span className="inline-flex items-center gap-1.5">
                  <CurrencyDollar size={14} className="text-ink-soft" aria-hidden />
                  {t("businessPlan.review.signals.revenue")}
                </span>
              </SectionLabel>
              <ProjectionRow
                label={t("businessPlan.review.projection.month3")}
                value={option.projection.month3}
              />
              <ProjectionRow
                label={t("businessPlan.review.projection.month6")}
                value={option.projection.month6}
              />
              <ProjectionRow
                label={t("businessPlan.review.projection.month12")}
                value={option.projection.month12}
                isLast
              />
              {option.projection.assumption.trim() !== "" && (
                <p className="text-[11px] text-ink-soft mt-2 leading-[1.4] m-0">
                  {option.projection.assumption}
                </p>
              )}
            </Card>
          </div>

          {/* How it makes money + Marketing */}
          <div className="flex gap-3.5 flex-wrap">
            {option.pricing !== null && option.pricing.items.length > 0 && (
              <Card className="flex-1 min-w-[200px]">
                <SectionLabel>{t("businessPlan.review.howMonetizes")}</SectionLabel>
                {option.pricing.items.map((item, i) => (
                  <div
                    key={i}
                    className={`flex justify-between items-center py-1.5 text-[13px] ${i < option.pricing!.items.length - 1 ? "border-b border-surface-soft" : ""}`}
                  >
                    <span className="text-ink">{item.name}</span>
                    <span className="font-mono font-semibold text-brand">
                      {formatChargeItem(item, {
                        perMonth: t("businessPlan.charge.perMonth"),
                        perYear: t("businessPlan.charge.perYear"),
                      })}
                    </span>
                  </div>
                ))}
              </Card>
            )}

            {chips.length > 0 && (
              <Card className="flex-1 min-w-[200px]">
                <SectionLabel>{t("businessPlan.review.marketingLabel")}</SectionLabel>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((chip, i) => (
                    <Chip key={i}>{chip}</Chip>
                  ))}
                </div>
                {option.marketing.laterChannels.trim() !== "" && (
                  <p className="text-[11px] text-ink-soft mt-2 m-0">
                    {t("businessPlan.laterChannels")}: {option.marketing.laterChannels}
                  </p>
                )}
              </Card>
            )}
          </div>

          {/* Competition & differentiation */}
          {option.research !== null && (
            <Card>
              <SectionLabel>{t("businessPlan.review.competitionTitle")}</SectionLabel>
              <p className="text-[12.5px] text-ink-muted m-0 leading-relaxed">
                {option.research.competitors
                  .map((c) => c.name + (c.what ? ` (${c.what})` : ""))
                  .join(" · ")}
              </p>
              {option.research.differentiation.trim() !== "" && (
                <div className="mt-2.5 px-3 py-2 bg-brand-bg rounded-lg text-[12px] text-[#0c5d56] leading-relaxed">
                  <span className="font-semibold">
                    {t("businessPlan.review.differentialPrefix")}
                  </span>{" "}
                  {option.research.differentiation}
                </div>
              )}
            </Card>
          )}

          {/* About you */}
          {option.ownerProfile !== null && option.ownerProfile.trim() !== "" && (
            <Card>
              <SectionLabel>{t("businessPlan.review.aboutYou")}</SectionLabel>
              <p className="text-[13px] text-ink leading-[1.55] m-0 whitespace-pre-wrap">
                {option.ownerProfile}
              </p>
            </Card>
          )}

          {/* Dropped ideas */}
          {option.dropped.length > 0 && (
            <Card className="bg-[#FBFCFB] border-dashed">
              <SectionLabel>{t("businessPlan.review.droppedTitle")}</SectionLabel>
              {option.dropped.map((d, i) => (
                <DroppedRow key={i} idea={d.idea} reason={d.reason} />
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 flex items-center gap-3 px-6 py-3.5 bg-surface-card border-t border-surface-border">
        <span className="text-[12px] text-ink-muted hidden sm:block">
          {t("businessPlan.review.footerNote")}
        </span>
        <div className="ml-auto flex gap-2.5">
          <button
            type="button"
            onClick={onRequestAdjustments}
            disabled={submitting}
            className="text-[13.5px] font-medium px-[18px] py-[11px] rounded-[10px] text-ink border border-surface-border hover:border-brand hover:text-brand transition-colors disabled:opacity-50"
          >
            {adjustLabel}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={submitting}
            className="text-[13.5px] font-semibold px-[22px] py-[11px] rounded-[10px] bg-brand text-brand-fg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Legacy flat-plan view (no options, no signals) ────────────────────────────

type LegacyPlanProps = {
  plan: BusinessPlan;
  onRequestAdjustments: () => void;
  onApprove: () => void;
  submitting: boolean;
  approveLabel: string;
  adjustLabel: string;
};

const LegacyPlanView: FC<LegacyPlanProps> = ({
  plan,
  onRequestAdjustments,
  onApprove,
  submitting,
  approveLabel,
  adjustLabel,
}) => {
  const { t } = useTranslation();
  const chips = marketingChips(plan.marketing.tactics);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-[640px] mx-auto flex flex-col gap-4">
          {/* Title */}
          <h2 className="text-[23px] font-semibold text-ink tracking-[-0.02em] m-0 leading-tight">
            {plan.identity.name}{" "}
            <span className="font-mono text-[13px] text-brand font-normal">
              {plan.identity.proposedXHandle}
            </span>
          </h2>

          {/* O negócio */}
          <Card className="border-[#CFE6DD]">
            <SectionLabel>{t("businessPlan.review.concept")}</SectionLabel>
            <p className="text-[13px] text-ink leading-[1.55] m-0">{plan.concept}</p>
          </Card>

          {/* Monetization */}
          {plan.monetization.length > 0 && (
            <Card>
              <SectionLabel>{t("businessPlan.sections.monetization")}</SectionLabel>
              <ul className="text-[13px] text-ink list-disc pl-5 space-y-1 m-0">
                {plan.monetization.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Card>
          )}

          {/* Pricing */}
          {plan.pricing !== null && plan.pricing.items.length > 0 && (
            <Card>
              <SectionLabel>{t("businessPlan.review.howMonetizes")}</SectionLabel>
              {plan.pricing.items.map((item, i) => (
                <div
                  key={i}
                  className={`flex justify-between items-center py-1.5 text-[13px] ${i < plan.pricing!.items.length - 1 ? "border-b border-surface-soft" : ""}`}
                >
                  <span className="text-ink">{item.name}</span>
                  <span className="font-mono font-semibold text-brand">
                    {formatChargeItem(item, {
                      perMonth: t("businessPlan.charge.perMonth"),
                      perYear: t("businessPlan.charge.perYear"),
                    })}
                  </span>
                </div>
              ))}
              {plan.pricing.rationale.trim() !== "" && (
                <p className="text-[11px] text-ink-soft mt-2 m-0">{plan.pricing.rationale}</p>
              )}
            </Card>
          )}

          {/* Marketing */}
          {chips.length > 0 && (
            <Card>
              <SectionLabel>{t("businessPlan.review.marketingLabel")}</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((chip, i) => (
                  <Chip key={i}>{chip}</Chip>
                ))}
              </div>
              {plan.marketing.laterChannels.trim() !== "" && (
                <p className="text-[11px] text-ink-soft mt-2 m-0">
                  {t("businessPlan.laterChannels")}: {plan.marketing.laterChannels}
                </p>
              )}
            </Card>
          )}

          {/* Competition */}
          {plan.research !== null && (
            <Card>
              <SectionLabel>{t("businessPlan.review.competitionTitle")}</SectionLabel>
              <p className="text-[12.5px] text-ink-muted m-0 leading-relaxed">
                {plan.research.competitors
                  .map((c) => c.name + (c.what ? ` (${c.what})` : ""))
                  .join(" · ")}
              </p>
              {plan.research.differentiation.trim() !== "" && (
                <div className="mt-2.5 px-3 py-2 bg-brand-bg rounded-lg text-[12px] text-[#0c5d56] leading-relaxed">
                  <span className="font-semibold">
                    {t("businessPlan.review.differentialPrefix")}
                  </span>{" "}
                  {plan.research.differentiation}
                </div>
              )}
            </Card>
          )}

          {/* About you */}
          {plan.ownerProfile !== null && plan.ownerProfile.trim() !== "" && (
            <Card>
              <SectionLabel>{t("businessPlan.review.aboutYou")}</SectionLabel>
              <p className="text-[13px] text-ink leading-[1.55] m-0 whitespace-pre-wrap">
                {plan.ownerProfile}
              </p>
            </Card>
          )}

          {/* Identity */}
          <Card className="border-brand/40 bg-brand/5">
            <SectionLabel>{t("businessPlan.sections.identity")}</SectionLabel>
            <dl className="text-[13px] space-y-1 m-0">
              <div className="flex gap-2">
                <dt className="w-20 text-ink-soft">{t("businessPlan.identity.name")}</dt>
                <dd className="font-semibold m-0">{plan.identity.name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 text-ink-soft">{t("businessPlan.identity.voice")}</dt>
                <dd className="m-0">{plan.identity.voice}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 text-ink-soft">{t("businessPlan.identity.handle")}</dt>
                <dd className="font-semibold m-0">{plan.identity.proposedXHandle}</dd>
              </div>
            </dl>
            <p className="text-[11px] text-ink-soft mt-2 m-0">{t("businessPlan.handleHint")}</p>
          </Card>

          {/* Dropped */}
          {plan.dropped.length > 0 && (
            <Card className="bg-[#FBFCFB] border-dashed">
              <SectionLabel>{t("businessPlan.review.droppedTitle")}</SectionLabel>
              {plan.dropped.map((d, i) => (
                <DroppedRow key={i} idea={d.idea} reason={d.reason} />
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 flex items-center gap-3 px-6 py-3.5 bg-surface-card border-t border-surface-border">
        <span className="text-[12px] text-ink-muted hidden sm:block">
          {t("businessPlan.review.footerNote")}
        </span>
        <div className="ml-auto flex gap-2.5">
          <button
            type="button"
            onClick={onRequestAdjustments}
            disabled={submitting}
            className="text-[13.5px] font-medium px-[18px] py-[11px] rounded-[10px] text-ink border border-surface-border hover:border-brand hover:text-brand transition-colors disabled:opacity-50"
          >
            {adjustLabel}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={submitting}
            className="text-[13.5px] font-semibold px-[22px] py-[11px] rounded-[10px] bg-brand text-brand-fg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Root component ────────────────────────────────────────────────────────────

export const BusinessPlanReview: FC<{ plan: BusinessPlan }> = ({ plan }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const approve = useBusinessPlanStore((s) => s.approve);
  const reject = useBusinessPlanStore((s) => s.reject);
  const backToOptions = useBusinessPlanStore((s) => s.backToOptions);
  const chosenIndex = useBusinessPlanStore((s) => s.chosenIndex);
  const ceo = useAgentsStore((s) => s.agents.find(isCeoAgent) ?? null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRefine, setShowRefine] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [done, setDone] = useState(false);

  const handleApprove = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await approve();
      if (!res.ok) setError(res.error ?? t("businessPlan.approveFailed"));
      else setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefine = async (): Promise<void> => {
    const fb = refineText.trim();
    if (fb === "") return;
    setSubmitting(true);
    setError(null);
    try {
      await reject(fb);
      if (ceo !== null) {
        await window.prospero.agents.sendMessage({
          agentId: ceo.id,
          content: t("businessPlan.refineMessage", { feedback: fb }),
        });
      }
      navigate(-1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Success state — shared between enriched and legacy flows
  if (done) {
    return (
      <div className="bg-surface-card border border-surface-border rounded p-6 text-sm">
        <p className="font-semibold text-semantic-success">{t("businessPlan.applied.title")}</p>
        <p className="text-ink-muted mt-1">{t("businessPlan.applied.detail")}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 px-4 py-2 bg-brand text-brand-fg rounded font-semibold"
        >
          {t("businessPlan.applied.continue")}
        </button>
      </div>
    );
  }

  // Refine textarea overlay (shared between both views — shown below the main content)
  const refinePanel = showRefine ? (
    <div className="px-6 py-4 border-t border-surface-border bg-surface-card">
      <div className="max-w-[640px] mx-auto flex flex-col gap-2">
        <textarea
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          rows={3}
          placeholder={t("businessPlan.review.refinePlaceholder")}
          className="w-full px-2 py-1.5 border border-surface-border rounded bg-surface text-xs"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleRefine()}
            disabled={submitting || refineText.trim() === ""}
            className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
          >
            {t("businessPlan.review.sendRefine")}
          </button>
          <button
            type="button"
            onClick={() => setShowRefine(false)}
            className="text-xs px-3 py-1.5 border border-surface-border rounded text-ink-muted"
          >
            {t("businessPlan.applied.continue") /* reuse "Continue" as generic close label */}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const errorBanner =
    error !== null ? (
      <div className="px-6 py-2">
        <p className="text-sm text-semantic-danger">{error}</p>
      </div>
    ) : null;

  // Resolve chosen option (options flow)
  const chosenOption = resolveChosenOption(plan.options, chosenIndex);

  const approveLabel = submitting ? t("businessPlan.approving") : t("businessPlan.approve");
  const adjustLabel = t("businessPlan.review.requestAdjustments");

  if (chosenOption !== null) {
    // Enriched options-flow view
    return (
      <div className="flex flex-col h-full">
        <EnrichedPlanView
          option={chosenOption}
          onBackToOptions={backToOptions}
          onRequestAdjustments={() => setShowRefine((v) => !v)}
          onApprove={() => void handleApprove()}
          submitting={submitting}
          approveLabel={approveLabel}
          adjustLabel={adjustLabel}
        />
        {refinePanel}
        {errorBanner}
      </div>
    );
  }

  // Legacy flat-plan view (plan.options === null or chosenIndex === null)
  return (
    <div className="flex flex-col h-full">
      <LegacyPlanView
        plan={plan}
        onRequestAdjustments={() => setShowRefine((v) => !v)}
        onApprove={() => void handleApprove()}
        submitting={submitting}
        approveLabel={approveLabel}
        adjustLabel={adjustLabel}
      />
      {refinePanel}
      {errorBanner}
    </div>
  );
};
