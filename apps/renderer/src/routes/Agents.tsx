import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { isCeoAgent } from "@prospero/shared";
import { useAgentsStore } from "../stores/agents.js";
import { RoleTemplateGalleryModal } from "../components/RoleTemplateGalleryModal.js";
import { ReassignConfirmModal } from "../components/org/ReassignConfirmModal.js";
import { AgentCard } from "../components/equipe/AgentCard.js";

// Estúdio redesign — "Cards de papel" layout:
// CEO hero card + 2-col grid of agent cards.
// Reparent via ⋯ menu → parent picker modal → ReassignConfirmModal (cycle-error toast preserved).

export const Agents: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useAgentsStore((s) => s.agents);
  const setReportsTo = useAgentsStore((s) => s.setReportsTo);

  const [showGallery, setShowGallery] = useState(false);
  const [reassignChildId, setReassignChildId] = useState<string | null>(null);
  const [pendingReassign, setPendingReassign] = useState<{
    childId: string;
    parentId: string;
  } | null>(null);
  const [reassignError, setReassignError] = useState<string | null>(null);

  // Auto-dismiss the cycle error toast after 4s.
  useEffect(() => {
    if (reassignError === null) return;
    const h = setTimeout(() => setReassignError(null), 4000);
    return () => clearTimeout(h);
  }, [reassignError]);

  const live = agents.filter((a) => a.status !== "terminated");
  const ceo = live.find(isCeoAgent) ?? null;
  const team = live.filter((a) => a.id !== ceo?.id);
  const isEmpty = live.length === 0;

  const childName =
    pendingReassign !== null
      ? (agents.find((a) => a.id === pendingReassign.childId)?.name ?? "?")
      : "";
  const parentName =
    pendingReassign !== null
      ? (agents.find((a) => a.id === pendingReassign.parentId)?.name ?? "?")
      : "";

  // The agent whose manager we're picking (for the picker modal title).
  const reassignChildName =
    reassignChildId !== null ? (agents.find((a) => a.id === reassignChildId)?.name ?? "?") : "";

  return (
    <div className="h-full flex flex-col">
      <header className="bg-surface border-b border-surface-border px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[25px] font-semibold tracking-[-0.025em] text-ink">
              {t("equipe.title")}
            </h1>
            <p className="mt-1 text-[13px] text-ink-muted">{t("equipe.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowGallery(true)}
            className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 whitespace-nowrap"
          >
            {t("equipe.contratar")}
          </button>
        </div>
      </header>

      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-surface-soft p-8">
          <p className="text-base font-semibold text-ink">{t("equipe.empty.title")}</p>
          <p className="text-sm text-ink-muted">{t("equipe.empty.description")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-8 py-7">
          <div className="mx-auto max-w-3xl flex flex-col gap-5">
            {ceo !== null && (
              <AgentCard agent={ceo} hero onOpen={() => navigate(`/agents/${ceo.id}`)} />
            )}
            <div className="grid grid-cols-2 gap-3">
              {team.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  onOpen={() => navigate(`/agents/${a.id}`)}
                  onReassign={() => setReassignChildId(a.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Parent picker modal */}
      {reassignChildId !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("equipe.reassign.pickTitle", { name: reassignChildName })}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setReassignChildId(null)}
        >
          <div
            className="bg-surface-card border border-surface-border rounded-2xl p-6 w-80 max-h-[70vh] flex flex-col gap-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-ink">
              {t("equipe.reassign.pickTitle", { name: reassignChildName })}
            </h2>
            <p className="text-xs text-ink-muted">{t("equipe.reassign.pickHint")}</p>
            <ul className="overflow-auto flex flex-col gap-1.5" role="listbox">
              {live
                .filter((a) => a.id !== reassignChildId)
                .map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-ink hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      onClick={() => {
                        setPendingReassign({ childId: reassignChildId, parentId: a.id });
                        setReassignChildId(null);
                      }}
                    >
                      {a.name}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {pendingReassign !== null && (
        <ReassignConfirmModal
          childName={childName}
          newParentName={parentName}
          onCancel={() => setPendingReassign(null)}
          onConfirm={async () => {
            try {
              await setReportsTo(pendingReassign.childId, pendingReassign.parentId);
            } catch {
              setReassignError(t("org.reassign.cycleError"));
            }
            setPendingReassign(null);
          }}
        />
      )}

      {reassignError !== null && (
        <div className="fixed bottom-6 right-6 bg-semantic-danger text-white px-4 py-2 rounded shadow-lg text-xs z-50">
          {reassignError}
        </div>
      )}

      {showGallery && <RoleTemplateGalleryModal onClose={() => setShowGallery(false)} />}
    </div>
  );
};
