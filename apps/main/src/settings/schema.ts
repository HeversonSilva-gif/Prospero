import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  DEFAULT_CLAUDE_MODEL,
  MODEL_ID_REGEX,
  type AppSettings,
} from "@prospero/shared";

export const RemoteExecutionSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["local-docker", "remote-vps"]).default("local-docker"),
  vpsHost: z.string().default(""),
  vpsUser: z.string().default(""),
  vpsKeyPath: z.string().default(""),
});

export const AppSettingsSchema = z.object({
  language: z.enum(["pt-BR", "en-US"]).default("pt-BR"),
  theme: z.enum(["light", "dark"]).default("light"),
  workspaceCwd: z.string().nullable().default(null),
  defaultModelForNewAgents: z.string().regex(MODEL_ID_REGEX).default(DEFAULT_CLAUDE_MODEL),
  executorMode: z.enum(["atomic", "narrated"]).default("atomic"),
  activeCompanyId: z.string().nullable().default(null),
  authMode: z.enum(["oauth", "api-key"]).default("oauth"),
  defaultAgentMode: z.enum(["supervised", "auto"]).default("supervised"),
  defaultAlwaysOn: z.boolean().default(false),
  derivationsPerDayPerAgent: z.number().int().min(0).default(3),
  // Per-turn cache_read tokens above which a finished, idle turn triggers
  // compaction. Lowered 300k→75k (2026-06-04): at 300k the CEO's turns never
  // crossed it, so the session grew unbounded and the full prompt was re-read
  // every turn (the "98% cache_read"). Now that compaction distills the REAL
  // session transcript (session-transcript.ts), a lower threshold is safe and
  // is the direct lever on re-read volume. 0 disables compaction.
  compactionCacheReadThreshold: z.number().int().min(0).default(75_000),
  // Epoch ms until which the Max account is rate-limited; the team auto-resumes after. null = not limited.
  rateLimitedUntil: z.number().int().nullable().default(null),
  remoteExecution: RemoteExecutionSettingsSchema.default({
    enabled: false,
    mode: "local-docker",
    vpsHost: "",
    vpsUser: "",
    vpsKeyPath: "",
  }),
});

const PartialAppSettingsSchema = AppSettingsSchema.partial();

export const parseSettings = (raw: unknown): AppSettings => {
  const result = PartialAppSettingsSchema.safeParse(raw);
  if (!result.success) return { ...DEFAULT_SETTINGS };
  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  if (result.data.language !== undefined) merged.language = result.data.language;
  if (result.data.theme !== undefined) merged.theme = result.data.theme;
  if (result.data.workspaceCwd !== undefined) merged.workspaceCwd = result.data.workspaceCwd;
  if (result.data.defaultModelForNewAgents !== undefined) {
    merged.defaultModelForNewAgents = result.data.defaultModelForNewAgents;
  }
  if (result.data.executorMode !== undefined) {
    merged.executorMode = result.data.executorMode;
  }
  if (result.data.activeCompanyId !== undefined) {
    merged.activeCompanyId = result.data.activeCompanyId;
  }
  if (result.data.authMode !== undefined) {
    merged.authMode = result.data.authMode;
  }
  if (result.data.defaultAgentMode !== undefined) {
    merged.defaultAgentMode = result.data.defaultAgentMode;
  }
  if (result.data.defaultAlwaysOn !== undefined) {
    merged.defaultAlwaysOn = result.data.defaultAlwaysOn;
  }
  if (result.data.derivationsPerDayPerAgent !== undefined) {
    merged.derivationsPerDayPerAgent = result.data.derivationsPerDayPerAgent;
  }
  if (result.data.compactionCacheReadThreshold !== undefined) {
    merged.compactionCacheReadThreshold = result.data.compactionCacheReadThreshold;
  }
  if (result.data.rateLimitedUntil !== undefined) {
    merged.rateLimitedUntil = result.data.rateLimitedUntil;
  }
  if (result.data.remoteExecution !== undefined) {
    merged.remoteExecution = result.data.remoteExecution;
  }
  return merged;
};
