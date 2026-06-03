import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { CLAUDE_MODEL_PRESETS, MODEL_ID_REGEX } from "@prospero/shared";
import { categorizeCostTier, type CostTier } from "../lib/costs/categorizeCostTier.js";

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

const CUSTOM = "__custom__";

// Audit 2026-06-03 Inteligência & Contexto I3: the option list is derived from
// the shared CLAUDE_MODEL_PRESETS (single source of truth) so it can't drift to
// a stale id again. We only surface the models we ship a label for; the legacy
// `claude-opus-4-7` stays in the shared preset list (so existing agents pinned
// to it still render as a preset, not "Custom") but is no longer offered to pick.
const PRESET_LABEL_KEY: Record<string, string> = {
  "claude-opus-4-8": "settings.model.presetOpus",
  "claude-sonnet-4-6": "settings.model.presetSonnet",
  "claude-haiku-4-5-20251001": "settings.model.presetHaiku",
};

const SELECTABLE_PRESETS = (CLAUDE_MODEL_PRESETS as readonly string[]).filter(
  (id) => id in PRESET_LABEL_KEY,
);

const tierClass = (tier: CostTier): string => {
  switch (tier) {
    case "cheap":
      return "text-semantic-success";
    case "medium":
      return "text-brand";
    case "expensive":
      return "text-semantic-warning";
    default:
      return "text-ink-soft";
  }
};

const tierLabel = (tier: CostTier, t: ReturnType<typeof useTranslation>["t"]): string => {
  if (tier === "cheap") return t("model.costHint.cheap");
  if (tier === "medium") return t("model.costHint.medium");
  if (tier === "expensive") return t("model.costHint.expensive");
  return "";
};

export const ModelDropdown: FC<Props> = ({ value, onChange, disabled = false }) => {
  const { t } = useTranslation();
  // Only a *selectable* preset maps to the dropdown; a legacy id like
  // claude-opus-4-7 falls through to the Custom input so its value stays visible.
  const isPreset = SELECTABLE_PRESETS.includes(value);
  const [selectValue, setSelectValue] = useState<string>(isPreset ? value : CUSTOM);
  const [customValue, setCustomValue] = useState<string>(isPreset ? "" : value);
  const [error, setError] = useState<string | null>(null);

  const onSelect = (next: string): void => {
    setSelectValue(next);
    setError(null);
    if (next === CUSTOM) return;
    onChange(next);
  };

  const onCustomBlur = (): void => {
    if (selectValue !== CUSTOM) return;
    const trimmed = customValue.trim();
    if (trimmed === "" || !MODEL_ID_REGEX.test(trimmed)) {
      setError(t("settings.model.invalid"));
      return;
    }
    setError(null);
    onChange(trimmed);
  };

  const selectedTier = categorizeCostTier(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <select
          value={selectValue}
          onChange={(e) => onSelect(e.target.value)}
          disabled={disabled}
          className="flex-1 px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm"
        >
          {SELECTABLE_PRESETS.map((id) => (
            <option key={id} value={id}>
              {t(PRESET_LABEL_KEY[id]!)}
            </option>
          ))}
          <option value={CUSTOM}>{t("settings.model.custom")}</option>
        </select>
        {selectedTier.symbol !== "" && (
          <span
            className={`text-xs font-mono font-semibold ${tierClass(selectedTier.tier)}`}
            title={tierLabel(selectedTier.tier, t)}
          >
            {selectedTier.symbol}
          </span>
        )}
      </div>
      {selectValue === CUSTOM && (
        <input
          type="text"
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onBlur={onCustomBlur}
          placeholder={t("settings.model.customPlaceholder")}
          disabled={disabled}
          className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
        />
      )}
      {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
    </div>
  );
};
