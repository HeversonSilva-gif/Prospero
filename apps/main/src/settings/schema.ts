import { z } from "zod";
import { DEFAULT_SETTINGS, type AppSettings } from "@dashboard-agent/shared";

export const AppSettingsSchema = z.object({
  language: z.enum(["pt-BR", "en-US"]),
  theme: z.enum(["light", "dark"]),
});

const PartialAppSettingsSchema = AppSettingsSchema.partial();

export const parseSettings = (raw: unknown): AppSettings => {
  const result = PartialAppSettingsSchema.safeParse(raw);
  if (!result.success) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...result.data };
};
