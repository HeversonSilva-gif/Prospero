// Single source of truth for the model vocabulary. The CEO picks an ABSTRACT
// preset (opus/sonnet/haiku, easy to reason about + matches the model rubric);
// resolveModelPreset translates it to the current real Claude model id at hire
// time. When a model version bumps (4.8 → 4.9), change ONLY this map. The
// `*-thinking` presets map to the same base id for now (real thinking-mode wiring
// is a follow-up). Plain TS (no zod) so both the goal/org schemas and the hire
// paths can import it.

export const MODEL_PRESETS = [
  "opus-4",
  "sonnet-4",
  "haiku-4",
  "opus-4-thinking",
  "sonnet-4-thinking",
] as const;

export type ModelPreset = (typeof MODEL_PRESETS)[number];

const PRESET_TO_ID: Record<ModelPreset, string> = {
  "opus-4": "claude-opus-4-8",
  "sonnet-4": "claude-sonnet-4-6",
  "haiku-4": "claude-haiku-4-5-20251001",
  "opus-4-thinking": "claude-opus-4-8",
  "sonnet-4-thinking": "claude-sonnet-4-6",
};

const DEFAULT_ID = "claude-sonnet-4-6";

// Maps a preset to a real id. Passes a real `claude-*` id through unchanged
// (defensive: legacy data / manual overrides). Unknown → sonnet default.
export const resolveModelPreset = (preset: string): string => {
  if (preset in PRESET_TO_ID) return PRESET_TO_ID[preset as ModelPreset];
  if (preset.startsWith("claude-")) return preset;
  return DEFAULT_ID;
};
