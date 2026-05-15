import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { RoleTemplate } from "@prospero/shared";

type Props = {
  currentRoleId: string | null;
  onConfirm: (roleId: string, preserveModel: boolean) => void | Promise<void>;
  onCancel: () => void;
};

export const ChangeRoleModal: FC<Props> = ({ currentRoleId, onConfirm, onCancel }) => {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(currentRoleId);
  const [preserveModel, setPreserveModel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const list = await window.prospero.roles.list();
      setRoles(list);
    })();
  }, []);

  const submit = async (): Promise<void> => {
    if (selectedId === null || selectedId === currentRoleId) return;
    setBusy(true);
    try {
      await onConfirm(selectedId, preserveModel);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center">
      <div className="bg-surface-card rounded-lg shadow-xl w-[420px] p-5">
        <h2 className="text-sm font-bold text-brand-dark mb-1">
          {t("agent.config.role.modalTitle")}
        </h2>
        <p className="text-[11px] text-ink-muted mb-4">{t("agent.config.role.modalWarning")}</p>
        <label className="block text-[10px] uppercase text-ink-soft mb-1 font-semibold">
          {t("agent.config.role.selectLabel")}
        </label>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value === "" ? null : e.target.value)}
          className="w-full text-xs px-2 py-1.5 border border-surface-border rounded mb-3 bg-surface"
        >
          <option value="">—</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.defaultModel})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[11px] text-ink-muted mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={preserveModel}
            onChange={(e) => setPreserveModel(e.target.checked)}
          />
          {t("agent.config.role.preserveModel")}
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1 bg-surface-soft text-ink-muted rounded"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || selectedId === null || selectedId === currentRoleId}
            className="text-xs px-3 py-1 bg-brand text-brand-fg rounded disabled:opacity-50"
          >
            {busy ? "…" : t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
