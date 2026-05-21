import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { isCeoAgent } from "@prospero/shared";
import { useRolesStore } from "../stores/roles.js";
import { useAgentsStore } from "../stores/agents.js";

type Props = { onClose: () => void };

// "Contratar alguém" leads with the conversational model: the owner describes
// the team they need and the CEO designs it (the CEO's org-architect prompt ->
// submit_org_plan -> /org-plan review). Picking a ready-made template stays as a
// secondary path.
export const RoleTemplateGalleryModal = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roles = useRolesStore((s) => s.roles);
  const load = useRolesStore((s) => s.load);
  const agents = useAgentsStore((s) => s.agents);
  const ceo = useMemo(() => agents.find(isCeoAgent) ?? null, [agents]);

  const [need, setNeed] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (templateId: string) => {
    onClose();
    navigate(`/agents/new?template=${encodeURIComponent(templateId)}`);
  };

  const askCeo = async () => {
    if (ceo === null || need.trim() === "") return;
    setBusy(true);
    try {
      await window.prospero.agents.sendMessage(ceo.id, need.trim());
      onClose();
      navigate(`/agents/${ceo.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t("agents.gallery.hireTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-soft hover:text-ink-muted text-xl leading-none"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        {/* Primary: describe the need, the CEO designs the team. */}
        <p className="text-sm text-ink mb-2">{t("agents.gallery.describeSubtitle")}</p>
        {ceo === null ? (
          <p className="text-xs text-ink-muted mb-4">{t("agents.gallery.noCeo")}</p>
        ) : (
          <div className="mb-5">
            <textarea
              value={need}
              onChange={(e) => setNeed(e.target.value)}
              rows={3}
              placeholder={t("agents.gallery.describePlaceholder")}
              className="w-full px-3 py-2 border border-surface-border rounded bg-surface-card text-sm"
            />
            <div className="flex justify-end mt-2">
              <button
                type="button"
                onClick={() => void askCeo()}
                disabled={busy || need.trim() === ""}
                className="px-4 py-2 text-sm font-semibold bg-brand text-brand-fg rounded disabled:opacity-50"
              >
                {t("agents.gallery.askCeo")}
              </button>
            </div>
          </div>
        )}

        {/* Secondary: start from a ready-made template. */}
        <div className="flex items-center gap-3 my-4">
          <span className="h-px flex-1 bg-surface-border" />
          <span className="text-[11px] uppercase tracking-wide text-ink-soft">
            {t("agents.gallery.orTemplate")}
          </span>
          <span className="h-px flex-1 bg-surface-border" />
        </div>

        {roles.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("agents.gallery.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pick(r.id)}
                className="text-left p-4 border border-surface-border rounded hover:border-brand transition-colors"
              >
                <div className="flex items-start gap-2 mb-1">
                  {r.icon !== null && <span className="text-xl shrink-0">{r.icon}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink">{r.name}</div>
                    <div className="text-xs text-ink-muted truncate">
                      {r.agentCount} {t("agents.gallery.agentsCount")}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-ink-muted line-clamp-2">{r.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
