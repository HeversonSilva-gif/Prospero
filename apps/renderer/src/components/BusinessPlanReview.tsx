import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isCeoAgent, type BusinessPlan } from "@prospero/shared";
import { useBusinessPlanStore } from "../stores/businessPlan.js";
import { useAgentsStore } from "../stores/agents.js";
import { DecisionPage, DecisionHeader, HeroSummary, DecisionActions } from "./decision/index.js";

export const BusinessPlanReview: FC<{ plan: BusinessPlan }> = ({ plan }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const approve = useBusinessPlanStore((s) => s.approve);
  const reject = useBusinessPlanStore((s) => s.reject);
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

  return (
    <DecisionPage
      header={
        <DecisionHeader
          chip={{ variant: "brand", label: t("businessPlan.chip") }}
          meta={t("businessPlan.meta")}
          title={plan.identity.name}
        />
      }
      hero={
        <HeroSummary
          variant="brand"
          stats={[{ label: t("businessPlan.stats.channel"), value: "X" }]}
        />
      }
      sections={[
        <section
          key="feas"
          className="text-xs text-ink-soft bg-semantic-success-bg/20 border border-surface-border rounded-md px-4 py-3"
        >
          {t("businessPlan.feasibilityNote")}
        </section>,
        <section key="concept">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink mb-2 m-0">
            {t("businessPlan.sections.concept")}
          </h3>
          <p className="text-sm text-ink whitespace-pre-wrap">{plan.concept}</p>
        </section>,
        <section key="money">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink mb-2 m-0">
            {t("businessPlan.sections.monetization")}
          </h3>
          <ul className="text-sm text-ink list-disc pl-5 space-y-1">
            {plan.monetization.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>,
        plan.pricing !== null ? (
          <section key="charge" className="rounded-md border border-brand/40 bg-brand/5 px-4 py-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink mb-2 m-0">
              {t("businessPlan.charge.title")}
            </h3>
            <ul className="text-sm text-ink space-y-1">
              {plan.pricing.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{it.name}</span>
                  <span className="font-semibold whitespace-nowrap">
                    {it.currency.toUpperCase()} {(it.amount / 100).toFixed(2)}
                    {it.interval === "month"
                      ? ` ${t("businessPlan.charge.perMonth")}`
                      : it.interval === "year"
                        ? ` ${t("businessPlan.charge.perYear")}`
                        : ""}
                  </span>
                </li>
              ))}
            </ul>
            {plan.pricing.rationale.trim() !== "" && (
              <p className="text-xs text-ink-soft mt-2">{plan.pricing.rationale}</p>
            )}
          </section>
        ) : null,
        plan.research !== null ? (
          <section key="research">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink mb-2 m-0">
              {t("businessPlan.research.title")}
            </h3>
            <ul className="text-sm text-ink space-y-1">
              {plan.research.competitors.map((c, i) => (
                <li key={i}>
                  <span className="font-semibold">{c.name}</span> — {c.what}
                  {c.price !== undefined && c.price !== "" ? ` (${c.price})` : ""}
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-soft mt-2">
              <span className="font-semibold">{t("businessPlan.research.differentiation")}:</span>{" "}
              {plan.research.differentiation}
            </p>
          </section>
        ) : null,
        plan.ownerProfile !== null && plan.ownerProfile.trim() !== "" ? (
          <section key="owner">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink mb-2 m-0">
              {t("businessPlan.owner.title")}
            </h3>
            <p className="text-sm text-ink whitespace-pre-wrap">{plan.ownerProfile}</p>
          </section>
        ) : null,
        <section key="mkt">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink mb-2 m-0">
            {t("businessPlan.sections.marketing")}
          </h3>
          <p className="text-xs text-ink-soft mb-1">{t("businessPlan.initialChannelX")}</p>
          <ul className="text-sm text-ink list-disc pl-5 space-y-1">
            {plan.marketing.tactics.map((tac, i) => (
              <li key={i}>{tac}</li>
            ))}
          </ul>
          {plan.marketing.laterChannels.trim() !== "" && (
            <p className="text-xs text-ink-soft mt-2">
              {t("businessPlan.laterChannels")}: {plan.marketing.laterChannels}
            </p>
          )}
        </section>,
        <section key="identity" className="rounded-md border border-brand/40 bg-brand/5 px-4 py-3">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink mb-2 m-0">
            {t("businessPlan.sections.identity")}
          </h3>
          <dl className="text-sm space-y-1">
            <div className="flex gap-2">
              <dt className="w-20 text-ink-soft">{t("businessPlan.identity.name")}</dt>
              <dd className="font-semibold">{plan.identity.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 text-ink-soft">{t("businessPlan.identity.voice")}</dt>
              <dd>{plan.identity.voice}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 text-ink-soft">{t("businessPlan.identity.handle")}</dt>
              <dd className="font-semibold">{plan.identity.proposedXHandle}</dd>
            </div>
          </dl>
          <p className="text-[11px] text-ink-soft mt-2">{t("businessPlan.handleHint")}</p>
        </section>,
        plan.dropped.length > 0 ? (
          <section key="dropped">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-soft mb-2 m-0">
              {t("businessPlan.sections.dropped")}
            </h3>
            <ul className="text-xs text-ink-soft space-y-1">
              {plan.dropped.map((d, i) => (
                <li key={i}>
                  <span className="line-through">{d.idea}</span> — {d.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null,
        showRefine ? (
          <section key="refine" className="space-y-2">
            <textarea
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
              rows={3}
              placeholder={t("businessPlan.refinePlaceholder")}
              className="w-full px-2 py-1.5 border border-surface-border rounded bg-surface text-xs"
            />
            <button
              type="button"
              onClick={() => void handleRefine()}
              disabled={submitting || refineText.trim() === ""}
              className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
            >
              {t("businessPlan.sendRefine")}
            </button>
          </section>
        ) : null,
        error !== null ? (
          <p key="err" className="text-sm text-semantic-danger">
            {error}
          </p>
        ) : null,
      ]}
      actions={
        <DecisionActions
          onApprove={() => void handleApprove()}
          onReject={() => setShowRefine((v) => !v)}
          approveLabel={submitting ? t("businessPlan.approving") : t("businessPlan.approve")}
          rejectLabel={t("businessPlan.refine")}
          disabled={submitting}
        />
      }
    />
  );
};
