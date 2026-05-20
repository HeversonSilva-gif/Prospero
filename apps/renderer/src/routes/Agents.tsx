import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAgentsStore } from "../stores/agents.js";
import { RoleTemplateGalleryModal } from "../components/RoleTemplateGalleryModal.js";
import { TrustTierBadge } from "../components/trust/TrustTierBadge.js";
import type { AgentStatus } from "@prospero/shared";

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "bg-ink-soft",
  thinking: "bg-brand",
  working: "bg-semantic-success",
  waiting: "bg-semantic-warning",
  error: "bg-semantic-danger",
  paused: "bg-semantic-warning",
  terminated: "bg-ink-soft",
};

export const Agents: FC = () => {
  const { t } = useTranslation();
  const agents = useAgentsStore((s) => s.agents);
  const [showGallery, setShowGallery] = useState(false);

  const live = agents.filter((a) => a.status !== "terminated");

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">{t("agents.list.title")}</h1>
        <button
          type="button"
          onClick={() => setShowGallery(true)}
          className="px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg rounded hover:opacity-90"
        >
          + {t("agents.list.new")}
        </button>
      </div>

      {live.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("agents.list.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {live.map((a) => {
            const showAction =
              (a.status === "working" || a.status === "thinking") &&
              a.currentAction !== null &&
              a.currentAction !== "";
            return (
              <Link
                key={a.id}
                to={`/agents/${a.id}`}
                className="block p-4 bg-surface-card border border-surface-border rounded-lg hover:border-brand transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLOR[a.status]}`}
                    title={a.status}
                  />
                  <span className="text-sm font-semibold text-ink truncate flex-1">{a.name}</span>
                </div>
                <div className="text-xs text-ink-muted">{a.role}</div>
                <div className="mt-1">
                  <TrustTierBadge tier={a.trustTier} agentId={a.id} />
                </div>
                {showAction && (
                  <div className="mt-2 text-[11px] italic text-ink-soft truncate">
                    {a.currentAction}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {showGallery && <RoleTemplateGalleryModal onClose={() => setShowGallery(false)} />}
    </div>
  );
};
