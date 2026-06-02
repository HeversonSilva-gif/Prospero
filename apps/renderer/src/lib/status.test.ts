import { describe, it, expect } from "vitest";
import { agentStatusInfo } from "./status.js";

describe("agentStatusInfo", () => {
  it("maps an active agent to jade tone", () => {
    expect(agentStatusInfo("active").tone).toBe("active");
  });
  it("maps a waiting-on-user agent to amber tone", () => {
    expect(agentStatusInfo("waiting").tone).toBe("wait");
  });
  it("maps idle/terminated to idle tone", () => {
    expect(agentStatusInfo("idle").tone).toBe("idle");
    expect(agentStatusInfo("terminated").tone).toBe("idle");
  });
  it("defaults unknown status to idle", () => {
    expect(agentStatusInfo("???").tone).toBe("idle");
  });
});
