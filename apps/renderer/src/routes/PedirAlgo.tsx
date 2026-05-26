import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isCeoAgent, type GoalWithPlan, type Message } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { useActiveCompanyId } from "../hooks/useActiveCompanyId.js";
import { MessageList } from "../components/MessageList.js";
import { Composer } from "../components/Composer.js";
import { OrgPlanProposedBanner } from "../components/OrgPlanProposedBanner.js";
import { deriveGoalTitle, scopeUserMessages } from "../lib/pedir.js";

// M16 gap #3 — "Pedir algo" is now a real conversation with the CEO that ends
// in a dedicated plan-review page (PlanoRevisao). The first message creates a
// draft goal and seeds the CEO chat; an explicit "Montar o plano" runs the
// existing goals.requestPlan (the CEO has the conversation in its session).
export const PedirAlgo: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { goalId } = useParams<{ goalId?: string }>();
  const agents = useAgentsStore((s) => s.agents);
  const ceo = useMemo(() => agents.find(isCeoAgent) ?? null, [agents]);

  const companyId = useActiveCompanyId();
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [goal, setGoal] = useState<GoalWithPlan | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [requesting, setRequesting] = useState(false);

  // Load goal + scoped conversation when viewing an in-progress request.
  const reload = useCallback(async () => {
    if (goalId === undefined || ceo === null) return;
    const g = await window.prospero.goals.get({ id: goalId });
    setGoal(g);
    const all = await window.prospero.messages.listByAgent(ceo.id);
    setMessages(scopeUserMessages(all, g.createdAt));
  }, [goalId, ceo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live updates: the CEO replies / produces a plan in the background.
  useEffect(() => {
    if (goalId === undefined || ceo === null) return;
    const off = window.prospero.agents.onEvent((ev) => {
      if (ev.kind === "message-append" && ev.agentId === ceo.id) void reload();
    });
    return off;
  }, [goalId, ceo, reload]);

  // While we asked for a plan but it has not landed yet, poll for it.
  const planning = goal !== null && goal.status === "planning" && goal.currentPlan === null;
  useEffect(() => {
    if (!planning) return;
    const id = setInterval(() => void reload(), 3000);
    return () => clearInterval(id);
  }, [planning, reload]);

  const planReady = goal?.currentPlan != null && goal.currentPlan.status === "proposed";

  const start = async () => {
    if (companyId === null || ceo === null || draft.trim() === "") return;
    setStarting(true);
    try {
      const created = await window.prospero.goals.create({
        companyId,
        title: deriveGoalTitle(draft),
        description: draft.trim(),
        level: "company",
      });
      await window.prospero.agents.sendMessage({ agentId: ceo.id, content: draft.trim() });
      navigate(`/pedir/${created.id}`);
    } finally {
      setStarting(false);
    }
  };

  const sendReply = async (text: string) => {
    if (ceo === null) return;
    await window.prospero.agents.sendMessage({ agentId: ceo.id, content: text });
    await reload();
  };

  const requestPlan = async () => {
    if (goalId === undefined) return;
    setRequesting(true);
    try {
      await window.prospero.goals.requestPlan({ goalId });
      await reload();
    } finally {
      setRequesting(false);
    }
  };

  if (ceo === null) {
    return <div className="p-8 text-sm text-ink-muted">{t("pedir.noCeo")}</div>;
  }

  // Empty state — new request.
  if (goalId === undefined) {
    return (
      <div className="flex flex-col h-full">
        <header className="px-8 py-6 border-b border-surface-border bg-surface">
          <h1 className="text-2xl font-bold text-ink">{t("pedir.title")}</h1>
          <p className="mt-1 text-sm text-ink-soft">{t("pedir.subtitle")}</p>
        </header>
        <div className="flex-1 overflow-auto p-8 max-w-2xl w-full mx-auto">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder={t("pedir.placeholder")}
            className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
          />
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting || draft.trim() === ""}
            className="mt-3 px-4 py-2 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
          >
            {t("pedir.start")}
          </button>
        </div>
      </div>
    );
  }

  // Conversation view for an in-progress request.
  return (
    <div className="flex flex-col h-full min-w-0">
      <header className="px-6 py-4 border-b border-surface-border bg-surface flex items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink truncate">{goal?.title ?? t("pedir.title")}</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/goals/new")}
          className="ml-auto text-xs px-2.5 py-1 bg-surface-soft text-ink-muted rounded hover:text-ink"
        >
          {t("pedir.newRequest")}
        </button>
      </header>

      <OrgPlanProposedBanner />

      {planReady && (
        <div className="px-6 py-2 bg-semantic-success/10 border-b border-surface-border flex items-center gap-3">
          <span className="text-sm text-ink">{t("pedir.planReady")}</span>
          <button
            type="button"
            onClick={() => navigate(`/pedir/${goalId}/plano`)}
            className="ml-auto text-xs px-3 py-1.5 bg-semantic-success text-white rounded font-semibold"
          >
            {t("pedir.viewPlan")}
          </button>
        </div>
      )}

      <MessageList messages={messages} agents={agents} activeAgent={ceo} />

      <div className="px-6 py-2 border-t border-surface-border flex items-center gap-2">
        <button
          type="button"
          onClick={() => void requestPlan()}
          disabled={requesting || planning}
          className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded font-semibold disabled:opacity-50"
        >
          {planning
            ? t("pedir.buildingPlan")
            : planReady
              ? t("pedir.rebuildPlan")
              : t("pedir.buildPlan")}
        </button>
        {planning && <span className="text-xs text-ink-soft">{t("pedir.ceoThinking")}</span>}
      </div>

      <Composer onSubmit={(text) => void sendReply(text)} />
    </div>
  );
};

export default PedirAlgo;
