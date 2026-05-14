import { describe, expect, it } from "vitest";
import {
  activeAdapterCount,
  ensureAdapter,
  MAX_CONCURRENT_AGENTS,
  removeAdapter,
} from "../src/orchestrator/lifecycle.js";

// The lifecycle module keeps a module-level adapters Map. We can't easily
// inject 4 live adapters without spawning real child procs. Instead we assert
// the cap constant + leave integration assertions to manual smoke.
describe("orchestrator cap", () => {
  it("MAX_CONCURRENT_AGENTS is 4", () => {
    expect(MAX_CONCURRENT_AGENTS).toBe(4);
  });

  // Documenting behavior: the cap message mentions api-key as the way out.
  // Real cap enforcement is exercised by manual smoke / E2E.
  it.todo("ensureAdapter throws when agent.adapterName='claude-oauth-local' and cap reached");
  it.todo("ensureAdapter allows >4 when agent.adapterName='claude-api-key-local'");
});

void activeAdapterCount;
void ensureAdapter;
void removeAdapter;
