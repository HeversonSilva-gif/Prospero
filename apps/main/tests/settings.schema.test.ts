import { describe, expect, it } from "vitest";
import { AppSettingsSchema, parseSettings } from "../src/settings/schema.js";

describe("settings schema", () => {
  it("accepts valid settings", () => {
    const parsed = AppSettingsSchema.parse({ language: "pt-BR", theme: "light" });
    expect(parsed.language).toBe("pt-BR");
    expect(parsed.theme).toBe("light");
  });

  it("rejects invalid language", () => {
    expect(() => AppSettingsSchema.parse({ language: "fr-FR", theme: "light" })).toThrow();
  });

  it("rejects invalid theme", () => {
    expect(() => AppSettingsSchema.parse({ language: "pt-BR", theme: "neon" })).toThrow();
  });

  it("parseSettings fills defaults for missing fields", () => {
    expect(parseSettings({})).toEqual({ language: "pt-BR", theme: "light", workspaceCwd: null });
  });

  it("parseSettings preserves valid partial input", () => {
    expect(parseSettings({ theme: "dark" })).toEqual({
      language: "pt-BR",
      theme: "dark",
      workspaceCwd: null,
    });
  });

  it("parseSettings drops unknown keys", () => {
    expect(parseSettings({ language: "en-US", garbage: "ignored" })).toEqual({
      language: "en-US",
      theme: "light",
      workspaceCwd: null,
    });
  });

  it("accepts workspaceCwd null", () => {
    const result = AppSettingsSchema.safeParse({
      language: "pt-BR",
      theme: "light",
      workspaceCwd: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts workspaceCwd absolute path string", () => {
    const result = AppSettingsSchema.safeParse({
      language: "pt-BR",
      theme: "light",
      workspaceCwd: "C:\\Workspace",
    });
    expect(result.success).toBe(true);
  });

  it("parseSettings backwards-compat: missing workspaceCwd defaults to null", () => {
    const merged = parseSettings({ language: "en-US", theme: "dark" });
    expect(merged.workspaceCwd).toBe(null);
    expect(merged.language).toBe("en-US");
  });
});
