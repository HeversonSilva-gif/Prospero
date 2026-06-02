import { describe, it, expect } from "vitest";
import type { InboxItem } from "@prospero/shared";
import { inboxRisk } from "./inbox-risk.js";

const approval = (toolName: unknown): InboxItem =>
  ({ kind: "approval", payloadJson: JSON.stringify({ toolName }) }) as unknown as InboxItem;

describe("inboxRisk", () => {
  it("money tools → money", () => {
    expect(inboxRisk(approval("setup_monetization"))).toBe("money");
    expect(inboxRisk(approval("create_payment_link"))).toBe("money");
  });
  it("publishing tools → publish", () => {
    expect(inboxRisk(approval("post_to_x"))).toBe("publish");
    expect(inboxRisk(approval("reply_on_x"))).toBe("publish");
    expect(inboxRisk(approval("deploy_app"))).toBe("publish");
    expect(inboxRisk(approval("send_email"))).toBe("publish");
  });
  it("unknown tool → null", () => {
    expect(inboxRisk(approval("read_emails"))).toBeNull();
    expect(inboxRisk(approval(123))).toBeNull();
  });
  it("non-approval kinds → null", () => {
    expect(inboxRisk({ kind: "suggestion", payloadJson: null } as unknown as InboxItem)).toBeNull();
  });
  it("malformed payload → null", () => {
    expect(
      inboxRisk({ kind: "approval", payloadJson: "not json" } as unknown as InboxItem),
    ).toBeNull();
    expect(inboxRisk({ kind: "approval", payloadJson: null } as unknown as InboxItem)).toBeNull();
  });
});
