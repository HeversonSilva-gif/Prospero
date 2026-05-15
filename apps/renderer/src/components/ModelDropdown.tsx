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
  const isPreset = (CLAUDE_MODEL_PRESETS as readonly string[]).includes(value);
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
          <option value="claude-opus-4-7">{t("settings.model.presetOpus")}</option>
          <option value="claude-sonnet-4-6">{t("settings.model.presetSonnet")}</option>
          <option value="claude-haiku-4-5-20251001">{t("settings.model.presetHaiku")}</option>
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
