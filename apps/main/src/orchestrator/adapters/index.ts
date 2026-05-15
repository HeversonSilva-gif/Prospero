import type {
  AgentAdapter,
  AgentAdapterFactory,
  AdapterName,
  SpawnContext,
} from "@prospero/shared";
import { ClaudeOAuthLocalAdapter } from "./claude-oauth-local/adapter.js";
import { ClaudeApiKeyLocalAdapter } from "./claude-api-key-local/adapter.js";

const claudeOAuthLocalFactory: AgentAdapterFactory = {
  name: "claude-oauth-local",
  create(ctx: SpawnContext): AgentAdapter {
    return new ClaudeOAuthLocalAdapter(ctx);
  },
};

const claudeApiKeyLocalFactory: AgentAdapterFactory = {
  name: "claude-api-key-local",
  create(ctx: SpawnContext): AgentAdapter {
    return new ClaudeApiKeyLocalAdapter(ctx);
  },
};

export const adapterRegistry: Record<AdapterName, AgentAdapterFactory | undefined> = {
  "claude-oauth-local": claudeOAuthLocalFactory,
  "claude-api-key-local": claudeApiKeyLocalFactory,
  "claude-oauth-remote-docker": undefined, // M10
};

export const createAdapter = (name: AdapterName, ctx: SpawnContext): AgentAdapter => {
  const factory = adapterRegistry[name];
  if (factory === undefined) {
    throw new Error(`Adapter '${name}' is not implemented yet`);
  }
  return factory.create(ctx);
};
