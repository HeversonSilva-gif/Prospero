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
    expect(parseSettings({})).toEqual({ language: "pt-BR", theme: "light" });
  });

  it("parseSettings preserves valid partial input", () => {
    expect(parseSettings({ theme: "dark" })).toEqual({ language: "pt-BR", theme: "dark" });
  });

  it("parseSettings drops unknown keys", () => {
    expect(parseSettings({ language: "en-US", garbage: "ignored" })).toEqual({
      language: "en-US",
      theme: "light",
    });
  });
});
