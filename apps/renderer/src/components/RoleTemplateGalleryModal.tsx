import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useRolesStore } from "../stores/roles.js";

type Props = { onClose: () => void };

export const RoleTemplateGalleryModal = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roles = useRolesStore((s) => s.roles);
  const load = useRolesStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (templateId: string) => {
    onClose();
    navigate(`/agents/new?template=${encodeURIComponent(templateId)}`);
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
          <h2 className="text-lg font-semibold">{t("agents.gallery.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-soft hover:text-ink-muted text-xl leading-none"
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>
        <p className="text-xs text-ink-muted mb-4">{t("agents.gallery.subtitle")}</p>

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
