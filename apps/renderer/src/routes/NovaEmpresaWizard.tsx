import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isCeoAgent, type Message } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { useCompaniesStore } from "../stores/companies.js";
import { MessageList } from "../components/MessageList.js";
import { Composer } from "../components/Composer.js";
import { OrgPlanProposedBanner } from "../components/OrgPlanProposedBanner.js";
import { BusinessPlanProposedBanner } from "../components/BusinessPlanProposedBanner.js";
import { OnboardingStepper } from "../components/OnboardingStepper.js";
import { deriveOnboardingPhase } from "../lib/onboarding.js";

// The Nova-empresa wizard (v0.1.36). Reached from CompanySwitcher's "+ Nova
// empresa", which already created the company AND its CEO (Opus 4.8) via
// createOnboarding and routed here with the new company id.
//
// This is "Pedir algo" specialized for onboarding: a live conversation with the
// fresh CEO that interviews the owner about the business, then proposes the team
// (surfaced by OrgPlanProposedBanner → /org-plan) and finally hands off to the
// first-project conversation. A phase stepper reflects progress; it is derived
// from observable state (team size + a pending org plan), never persisted.
const POLL_MS = 4000;

export const NovaEmpresaWizard: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { companyId } = useParams<{ companyId: string }>();
  const [searchParams] = useSearchParams();
  const door = searchParams.get("porta") as "ajuda" | "ideia" | null;

  const agents = useAgentsStore((s) => s.agents);
  const loadAgents = useAgentsStore((s) => s.load);
  const companies = useCompaniesStore((s) => s.companies);
  const activeId = useCompaniesStore((s) => s.activeId);
  const setActive = useCompaniesStore((s) => s.setActive);

  const ceo = useMemo(() => agents.find(isCeoAgent) ?? null, [agents]);
  const company = useMemo(
    () => companies.find((c) => c.id === companyId) ?? null,
    [companies, companyId],
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [orgPlanProposed, setOrgPlanProposed] = useState(false);
  const [businessPlanProposed, setBusinessPlanProposed] = useState(false);
  const seededFor = useRef<string | null>(null);

  // Make sure this company is the active one and its agents (incl. the CEO) are
  // loaded — handles a direct navigation, not just the create→navigate path.
  useEffect(() => {
    if (companyId === undefined) return;
    if (activeId !== companyId) void setActive(companyId);
    void loadAgents(companyId);
  }, [companyId, activeId, setActive, loadAgents]);

  const reload = useCallback(async () => {
    if (ceo === null) return;
    const all = await window.prospero.messages.listByAgent(ceo.id);
    setMessages(all);
  }, [ceo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Seed the conversation once: a brand-new CEO has an empty thread, so we kick
  // it off with an opening instruction (idempotent per company — only if the
  // thread is still empty after the first load). The message is tailored to the
  // door the user picked: "ajuda" (no idea) vs "ideia" (has an idea).
  useEffect(() => {
    if (ceo === null || companyId === undefined || company === null) return;
    if (seededFor.current === companyId) return;
    if (messages.length > 0) {
      seededFor.current = companyId; // already has history — never seed
      return;
    }
    seededFor.current = companyId;
    const seedKey = door === "ideia" ? "genesis.seed.idea" : "genesis.seed.help";
    void window.prospero.agents
      .sendMessage({ agentId: ceo.id, content: t(seedKey) })
      .then(() => reload());
  }, [ceo, companyId, company, door, messages.length, t, reload]);

  // Live append (same pattern as Pedir algo — avoids refetching the whole list).
  useEffect(() => {
    if (ceo === null) return;
    const off = window.prospero.agents.onEvent((ev) => {
      if (ev.kind !== "message-append" || ev.agentId !== ceo.id) return;
      const m = ev.message;
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    });
    return off;
  }, [ceo]);

  // Poll for a pending org plan + business plan + refresh the roster, so the
  // stepper advances even when the triggering write came from the MCP child
  // (no broadcast).
  useEffect(() => {
    if (companyId === undefined) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const [orgPlan, bizPlan] = await Promise.all([
          window.prospero.orgPlan.getCurrent(),
          window.prospero.businessPlan.getCurrent(),
        ]);
        if (!cancelled) {
          setOrgPlanProposed(orgPlan !== null);
          setBusinessPlanProposed(bizPlan !== null);
        }
      } catch {
        /* best-effort */
      }
      void loadAgents(companyId);
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [companyId, loadAgents]);

  const teamSize = useMemo(
    () => agents.filter((a) => !isCeoAgent(a) && a.status !== "terminated").length,
    [agents],
  );
  const phase = deriveOnboardingPhase({ teamSize, businessPlanProposed, orgPlanProposed });

  const sendReply = async (text: string): Promise<void> => {
    if (ceo === null) return;
    await window.prospero.agents.sendMessage({ agentId: ceo.id, content: text });
    await reload();
  };

  if (ceo === null) {
    return <div className="p-8 text-sm text-ink-muted">{t("novaEmpresa.preparing")}</div>;
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      <header className="px-6 py-4 border-b border-surface-border bg-surface flex items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink truncate">
            {company?.name ?? t("novaEmpresa.title")}
          </h1>
          <p className="text-xs text-ink-soft">{t("novaEmpresa.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/briefing")}
          className="ml-auto text-xs px-2.5 py-1 bg-surface-soft text-ink-muted rounded hover:text-ink"
        >
          {t("novaEmpresa.exit")}
        </button>
      </header>

      <OnboardingStepper active={phase} />

      <BusinessPlanProposedBanner />
      <OrgPlanProposedBanner />

      {phase === "projeto" && (
        <div className="px-6 py-3 bg-semantic-success/10 border-b border-surface-border flex items-center gap-3">
          <span className="text-sm text-ink">{t("novaEmpresa.teamReady")}</span>
          <button
            type="button"
            onClick={() => navigate("/goals/new")}
            className="ml-auto text-xs px-3 py-1.5 bg-semantic-success text-white rounded font-semibold whitespace-nowrap"
          >
            {t("novaEmpresa.defineProject")}
          </button>
        </div>
      )}

      <MessageList messages={messages} agents={agents} activeAgent={ceo} />

      <Composer onSubmit={(text) => void sendReply(text)} />
    </div>
  );
};

export default NovaEmpresaWizard;
