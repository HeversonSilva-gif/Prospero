import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { CAPABILITY_CATALOG, type RoleTemplate } from "@prospero/shared";
import { useRolesStore } from "../../stores/roles.js";

const MODELS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];

type Props = {
  // When set, the modal edits this role; otherwise it creates a new one.
  existing?: RoleTemplate;
  onClose: () => void;
};

export const RoleFormModal: FC<Props> = ({ existing, onClose }) => {
  const { t } = useTranslation();
  const create = useRolesStore((s) => s.create);
  const update = useRolesStore((s) => s.update);

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? "");
  const [model, setModel] = useState(existing?.defaultModel ?? "claude-sonnet-4-6");
  const [capabilities, setCapabilities] = useState<string[]>(
    existing?.defaultCapabilities ?? ["chat"],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCap = (id: string): void => {
    setCapabilities((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const submit = async (): Promise<void> => {
    if (name.trim() === "") {
      setError(t("roles.form.errorName"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        icon: icon.trim() === "" ? null : icon.trim(),
        defaultModel: model,
        defaultCapabilities: capabilities,
      };
      if (existing === undefined) {
        await create(payload);
      } else {
        await update({ id: existing.id, ...payload });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="bg-surface-card border border-surface-border rounded-lg w-full max-w-lg p-5 space-y-3">
        <h2 className="text-sm font-bold text-brand-dark">
          {existing === undefined ? t("roles.form.titleCreate") : t("roles.form.titleEdit")}
        </h2>

        <label className="block">
          <span className="text-[11px] text-ink-soft">{t("roles.form.name")}</span>
          <input
            className="w-full mt-1 text-sm px-2 py-1.5 rounded border border-surface-border bg-surface-soft"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("roles.form.namePlaceholder")}
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-ink-soft">{t("roles.form.description")}</span>
          <textarea
            className="w-full mt-1 text-sm px-2 py-1.5 rounded border border-surface-border bg-surface-soft h-16 resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("roles.form.descriptionPlaceholder")}
          />
        </label>

        <div className="flex gap-3">
          <label className="block w-24">
            <span className="text-[11px] text-ink-soft">{t("roles.form.icon")}</span>
            <input
              className="w-full mt-1 text-sm px-2 py-1.5 rounded border border-surface-border bg-surface-soft"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="🎯"
            />
          </label>
          <label className="block flex-1">
            <span className="text-[11px] text-ink-soft">{t("roles.form.model")}</span>
            <select
              className="w-full mt-1 text-sm px-2 py-1.5 rounded border border-surface-border bg-surface-soft"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <span className="text-[11px] text-ink-soft">{t("roles.form.capabilities")}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.keys(CAPABILITY_CATALOG).map((id) => (
              <label key={id} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.includes(id)}
                  onChange={() => toggleCap(id)}
                />
                {id}
              </label>
            ))}
          </div>
        </div>

        {error !== null && <p className="text-[11px] text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-surface-border text-ink-muted"
          >
            {t("roles.form.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-brand text-white disabled:opacity-40"
          >
            {busy ? t("roles.form.submitting") : t("roles.form.submit")}
          </button>
        </div>
      </div>
    </div>
  );
};
