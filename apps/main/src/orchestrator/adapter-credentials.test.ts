import { describe, expect, it } from "vitest";
import { resolveAdapterCredentials } from "./adapter-credentials.js";

const loaders = {
  loadOauthToken: () => "oauth-tok",
  loadApiKey: () => "api-key",
};

describe("resolveAdapterCredentials", () => {
  it("returns the OAuth token for claude-oauth-local", () => {
    expect(resolveAdapterCredentials("claude-oauth-local", loaders)).toEqual({
      oauthToken: "oauth-tok",
    });
  });

  it("returns the OAuth token for claude-oauth-remote-docker", () => {
    expect(resolveAdapterCredentials("claude-oauth-remote-docker", loaders)).toEqual({
      oauthToken: "oauth-tok",
    });
  });

  it("returns the API key for claude-api-key-local", () => {
    expect(resolveAdapterCredentials("claude-api-key-local", loaders)).toEqual({
      apiKey: "api-key",
    });
  });

  it("throws when the OAuth token is not configured", () => {
    expect(() =>
      resolveAdapterCredentials("claude-oauth-remote-docker", {
        ...loaders,
        loadOauthToken: () => null,
      }),
    ).toThrow(/OAuth token not configured/);
  });

  it("throws when the API key is not configured", () => {
    expect(() =>
      resolveAdapterCredentials("claude-api-key-local", {
        ...loaders,
        loadApiKey: () => null,
      }),
    ).toThrow(/API key not configured/);
  });

  it("throws for an unknown adapter name", () => {
    expect(() => resolveAdapterCredentials("bogus-adapter", loaders)).toThrow(/Unknown adapter/);
  });
});
