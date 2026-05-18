import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { Skill } from "@prospero/shared";

interface Props {
  agentName: string;
  skills: Skill[];
  onConfirm: (reason: string | undefined, promoteSkillIds: string[]) => void;
  onCancel: () => void;
}

export const TerminateConfirmModal: FC<Props> = ({ agentName, skills, onConfirm, onCancel }) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [promoteIds, setPromoteIds] = useState<Set<string>>(new Set());
  const toggle = (id: string): void => {
    setPromoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-surface-card rounded-lg shadow-xl w-[440px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-brand-dark mb-2">
          {t("agent.terminate.title")}
        </h2>
        <p className="text-sm text-ink-muted mb-3">
          {t("agent.terminate.message", { name: agentName })}
        </p>
        <label className="block text-xs text-ink-soft mb-1">
          {t("agent.terminate.reasonLabel")}
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full text-sm border border-surface-border rounded px-2 py-1 mb-4 h-20"
        />
        {skills.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-ink">{t("agent.terminate.promoteTitle")}</p>
            <p className="text-xs text-ink-muted mb-2">{t("agent.terminate.promoteHint")}</p>
            <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {skills.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={promoteIds.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-ink-muted">{s.description}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("agent.terminate.cancel")}
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm(reason.trim() === "" ? undefined : reason.trim(), [...promoteIds])
            }
            className="text-xs px-3 py-1 bg-semantic-danger text-white rounded font-semibold"
          >
            {t("agent.terminate.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
