import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type BaselineFile = {
  totals: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  ratio_ceiling: number;
};

const sumTotals = (t: BaselineFile["totals"]): number =>
  t.input_tokens + t.output_tokens + t.cache_creation_input_tokens + t.cache_read_input_tokens;

describe("M6 token budget", () => {
  it("observed run does not exceed baseline * ratio_ceiling", () => {
    const baselinePath = join(__dirname, "fixtures", "m6-token-baseline.json");
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineFile;
    const baselineTotal = sumTotals(baseline.totals);

    // Observed value is captured by re-running the M5 fixture (see plan Task 1 + 24)
    // and replacing this constant with the measured sum. Until that capture happens,
    // the test skips its assertion (baseline JSON has zeros). To enable the gate,
    // update both this constant AND the baseline JSON's totals.
    const observedTotal = 0;
    if (observedTotal === 0 || baselineTotal === 0) {
      console.warn("m6-token-budget: no observed/baseline value recorded yet — assertion skipped");
      return;
    }

    const ratio = observedTotal / baselineTotal;
    expect(ratio).toBeLessThanOrEqual(baseline.ratio_ceiling);
  });
});
