import type { DigestEntry } from "@prospero/shared";
import type { RunDerivationResult } from "../derivation/runner.js";
import { buildCompactionPrompt } from "./compaction-prompt.js";
import { parseCompactionOutput } from "./parse-compaction.js";
import { readDigest, writeDigest, foldEntries } from "./digest-store.js";

const COMPACTION_MODEL = "claude-sonnet-4-6";

export type CompactionInput = {
  companyId: string;
  projectId: string;
  agentId: string;
  transcript: string;
};

export type CompactionResult = { taskState: string; foldedCount: number };

export type CompactionWorkerDeps = {
  userDataDir: string;
  // Injected so the worker is testable without a real claude process.
  runDistill: (input: { prompt: string; model: string }) => Promise<RunDerivationResult>;
  // Hash of the entry's source files against the live repo (provenance).
  hashSources: (sourceFiles: string[]) => string;
  newId: () => string;
  now: () => number;
  // Record the distill's token cost (adapter_name='compaction').
  onCost: (usage: RunDerivationResult["usage"], model: string) => void;
};

export type CompactionWorker = { compact(input: CompactionInput): Promise<CompactionResult> };

export const createCompactionWorker = (deps: CompactionWorkerDeps): CompactionWorker => ({
  async compact(input) {
    const prompt = buildCompactionPrompt(input.transcript);
    const run = await deps.runDistill({ prompt, model: COMPACTION_MODEL });
    deps.onCost(run.usage, COMPACTION_MODEL);

    const parsed = parseCompactionOutput(run.text);
    if (parsed.kind === "discard") return { taskState: "", foldedCount: 0 };

    if (parsed.knowledge.length > 0) {
      const incoming: DigestEntry[] = parsed.knowledge.map((k) => ({
        id: deps.newId(),
        section: k.section,
        body: k.body,
        sourceFiles: k.sourceFiles,
        contentHash: deps.hashSources(k.sourceFiles),
        derivedAt: deps.now(),
      }));
      const current = readDigest(deps.userDataDir, input.companyId, input.projectId);
      writeDigest(deps.userDataDir, input.companyId, input.projectId, {
        version: 1,
        entries: foldEntries(current.entries, incoming),
      });
    }
    return { taskState: parsed.taskState, foldedCount: parsed.knowledge.length };
  },
});
