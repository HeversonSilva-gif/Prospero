import type { DigestEntry } from "@prospero/shared";
import type { RunDerivationResult } from "../derivation/runner.js";
import { buildCompactionPrompt } from "./compaction-prompt.js";
import { parseCompactionOutput } from "./parse-compaction.js";
import { readDigestAt, writeDigestAt, foldEntries } from "./digest-store.js";

const COMPACTION_MODEL = "claude-sonnet-4-6";

export type CompactionInput = {
  companyId: string;
  agentId: string;
  transcript: string;
  // Absolute path to the digest.json the distilled knowledge folds into. The
  // caller resolves this from the agent's compaction target (a project digest
  // for single-project agents, an agent-scoped digest for `[]`/multi). Making
  // the worker target-agnostic is what lets the CEO compact.
  digestPath: string;
};

export type CompactionResult = { taskState: string; foldedCount: number };

export type CompactionWorkerDeps = {
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
        trust: 0.5,
        accessCount: 0,
        lastAccessed: null,
      }));
      const current = readDigestAt(input.digestPath);
      writeDigestAt(input.digestPath, {
        version: 1,
        entries: foldEntries(current.entries, incoming),
        deepDives: current.deepDives,
      });
    }
    return { taskState: parsed.taskState, foldedCount: parsed.knowledge.length };
  },
});
