import { countChars, estimateTokens } from "./measure.js";
import { clamp } from "./clamp.js";
import { tokenjuiceConfig, budgetFor } from "./config.js";
import { shapers } from "./shapers.js";
import { recordToolOutputMetrics, type MetricsContext } from "./metrics.js";

export interface CompressStats {
  toolName: string;
  rawChars: number;
  reducedChars: number;
  estTokensSaved: number;
  mode: "json" | "text" | "passthrough";
  clamped: boolean;
}

export interface CompressOutput {
  text: string;
  stats: CompressStats;
}

export interface CompressInput {
  toolName: string;
  result: string;
}

export const compressToolResult = (input: CompressInput): CompressOutput => {
  const { toolName, result } = input;
  const rawChars = countChars(result);

  const mk = (text: string, mode: CompressStats["mode"], clamped: boolean): CompressOutput => {
    const reducedChars = countChars(text);
    return {
      text,
      stats: {
        toolName,
        rawChars,
        reducedChars,
        estTokensSaved: Math.max(0, estimateTokens(rawChars) - estimateTokens(reducedChars)),
        mode,
        clamped,
      },
    };
  };

  try {
    if (!tokenjuiceConfig.enabled || result.length < tokenjuiceConfig.minSize) {
      return mk(result, "passthrough", false);
    }

    // Shape (Fase 2): apply a registered per-tool shaper to parsed JSON, if any.
    let working = result;
    const shaper = shapers.get(toolName);
    if (shaper !== undefined) {
      try {
        working = JSON.stringify(shaper(JSON.parse(result), toolName));
      } catch {
        working = result; // shaper failed or non-JSON — keep original
      }
    }

    const budget = budgetFor(toolName);
    if (working.length <= budget) {
      return working === result ? mk(result, "passthrough", false) : mk(working, "json", false);
    }

    const clamped = clamp(working, {
      budgetChars: budget,
      maxFieldChars: tokenjuiceConfig.maxFieldChars,
      maxArrayItems: tokenjuiceConfig.maxArrayItems,
      toolName,
    });

    // If clamping barely helped — relative to what went INTO the clamp — skip the
    // marker noise and keep the pre-clamp text (preserving any shaper reduction).
    const workingChars = countChars(working);
    if (
      countChars(clamped.text) / Math.max(1, workingChars) >
      1 - tokenjuiceConfig.minReductionRatio
    ) {
      return working === result ? mk(result, "passthrough", false) : mk(working, "json", false);
    }
    return mk(clamped.text, clamped.mode, true);
  } catch (err) {
    console.warn("[tokenjuice] compress failed", err);
    return mk(result, "passthrough", false);
  }
};

export const processToolResult = (input: CompressInput & { ctx: MetricsContext }): string => {
  const { text, stats } = compressToolResult({ toolName: input.toolName, result: input.result });
  recordToolOutputMetrics(input.ctx, stats);
  return text;
};
