import { describe, it, expect } from "vitest";
import { agentStatusInfo } from "./status.js";

describe("agentStatusInfo", () => {
  it("working and thinking are the active tone (jade)", () => {
    expect(agentStatusInfo("working").tone).toBe("active");
    expect(agentStatusInfo("thinking").tone).toBe("active");
  });
  it("waiting and paused are the wait tone (amber)", () => {
    expect(agentStatusInfo("waiting").tone).toBe("wait");
    expect(agentStatusInfo("paused").tone).toBe("wait");
  });
  it("idle and terminated are the idle tone", () => {
    expect(agentStatusInfo("idle").tone).toBe("idle");
    expect(agentStatusInfo("terminated").tone).toBe("idle");
  });
  it("error is the error tone (danger)", () => {
    expect(agentStatusInfo("error").tone).toBe("error");
    expect(agentStatusInfo("error").textClass).toBe("text-semantic-danger");
  });
  it("terminated falls back to the idle label (no agentStatus.terminated key)", () => {
    expect(agentStatusInfo("terminated").labelKey).toBe("agentStatus.idle");
  });
  it("exposes the i18n labelKey for the status", () => {
    expect(agentStatusInfo("working").labelKey).toBe("agentStatus.working");
    expect(agentStatusInfo("waiting").labelKey).toBe("agentStatus.waiting");
  });
  it("defaults an unknown status to idle", () => {
    expect(agentStatusInfo("???").tone).toBe("idle");
    expect(agentStatusInfo("???").labelKey).toBe("agentStatus.idle");
  });
});
