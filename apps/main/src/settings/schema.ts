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
  language: z.enum(["pt-BR", "en-US"]),
  theme: z.enum(["light", "dark"]),
  workspaceCwd: z.string().nullable().default(null),
  defaultModelForNewAgents: z.string().regex(MODEL_ID_REGEX).default(DEFAULT_CLAUDE_MODEL),
  executorMode: z.enum(["atomic", "narrated"]).default("atomic"),
  activeCompanyId: z.string().nullable().default(null),
  authMode: z.enum(["oauth", "api-key"]).default("oauth"),
  defaultAgentMode: z.enum(["supervised", "auto"]).default("supervised"),
  defaultAlwaysOn: z.boolean().default(false),
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
  if (result.data.remoteExecution !== undefined) {
    merged.remoteExecution = result.data.remoteExecution;
  }
  return merged;
};
