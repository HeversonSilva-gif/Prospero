import type {
  AgentAdapter,
  AgentAdapterFactory,
  AdapterName,
  SpawnContext,
} from "@dashboard-agent/shared";
import { ClaudeOAuthLocalAdapter } from "./claude-oauth-local/adapter.js";

const claudeOAuthLocalFactory: AgentAdapterFactory = {
  name: "claude-oauth-local",
  create(ctx: SpawnContext): AgentAdapter {
    return new ClaudeOAuthLocalAdapter(ctx);
  },
};

export const adapterRegistry: Record<AdapterName, AgentAdapterFactory | undefined> = {
  "claude-oauth-local": claudeOAuthLocalFactory,
  "claude-api-key-local": undefined, // M9
  "claude-oauth-remote-docker": undefined, // M10
};

export const createAdapter = (name: AdapterName, ctx: SpawnContext): AgentAdapter => {
  const factory = adapterRegistry[name];
  if (factory === undefined) {
    throw new Error(`Adapter '${name}' is not implemented yet`);
  }
  return factory.create(ctx);
};
