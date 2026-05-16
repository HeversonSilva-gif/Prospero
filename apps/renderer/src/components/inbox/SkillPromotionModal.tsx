import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  skillId: string;
  onClose: () => void;
  onApproved: () => void;
}

// Reviews a pending skill-promotion request: shows the skill body and lets the
// user scope the promoted skill to a role (or leave it company-global).
export const SkillPromotionModal: FC<Props> = ({ skillId, onClose, onApproved }) => {
  const { t } = useTranslation();
  const [body, setBody] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [role, setRole] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { body: b } = await window.prospero.learning.readSkillBody(skillId);
        setBody(b);
      } catch {
        setBody("");
      }
      const roleTemplates = await window.prospero.roles.list();
      setRoles(roleTemplates.map((r) => r.id));
    })();
  }, [skillId]);

  const approve = (): void => {
    setBusy(true);
    void (async () => {
      try {
        await window.prospero.learning.approveSkillPromotion({
          skillId,
          appliesToRole: role === "" ? null : role,
        });
        onApproved();
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface border border-surface-border rounded-lg w-[32rem] max-w-[90vw] p-5">
        <h2 className="text-sm font-semibold text-ink mb-3">{t("inbox.skillPromotion.title")}</h2>
        <pre className="text-xs text-ink-muted whitespace-pre-wrap font-mono max-h-60 overflow-auto bg-surface-soft rounded p-2.5">
          {body ?? "…"}
        </pre>
        <label className="block text-xs text-ink-muted mt-3 mb-1">
          {t("inbox.skillPromotion.roleLabel")}
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full text-sm px-2.5 py-1.5 bg-surface-soft border border-surface-border rounded"
        >
          <option value="">{t("inbox.skillPromotion.allRoles")}</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="flex gap-2 mt-4 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 bg-surface-soft text-ink-muted rounded"
          >
            {t("inbox.skillPromotion.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={approve}
            className="text-xs px-3 py-1.5 bg-brand text-brand-fg rounded disabled:opacity-50"
          >
            {t("inbox.skillPromotion.approve")}
          </button>
        </div>
      </div>
    </div>
  );
};
