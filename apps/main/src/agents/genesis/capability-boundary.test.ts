import { describe, it, expect } from "vitest";
import { buildCapabilityBoundary } from "./capability-boundary.js";

describe("buildCapabilityBoundary", () => {
  it("lists what the AI can deliver (SaaS, writing, organization, automation)", () => {
    const text = buildCapabilityBoundary(["x"]);
    for (const k of ["SaaS", "writing", "organization", "automation"]) {
      expect(text.toLowerCase()).toContain(k.toLowerCase());
    }
  });

  it("excludes work the AI cannot do unaided (design, manual fulfillment)", () => {
    const text = buildCapabilityBoundary(["x"]).toLowerCase();
    expect(text).toContain("design");
    expect(text).toContain("cannot");
  });

  it("mentions X as the first marketing channel only when x is available", () => {
    expect(buildCapabilityBoundary(["x"]).toLowerCase()).toContain("x (text");
    expect(buildCapabilityBoundary([]).toLowerCase()).not.toContain("x (text");
  });

  it("does not promise a channel that is not available", () => {
    expect(buildCapabilityBoundary(["x"]).toLowerCase()).not.toContain("instagram");
  });

  // Genesis audit I7 — build/hosting (Cloudflare), email, and monetization (Stripe)
  // lines must key off the real connected-connector list, not be static prose. When
  // a connector is NOT connected, phrase the capability as "available once the owner
  // connects X", never as something the CEO can already do.
  describe("connector-keyed capability lines (I7)", () => {
    it("asserts Cloudflare hosting only when cloudflare is connected", () => {
      const connected = buildCapabilityBoundary(["x", "cloudflare"]).toLowerCase();
      const notConnected = buildCapabilityBoundary(["x"]).toLowerCase();
      expect(connected).toContain("cloudflare");
      // Both mention Cloudflare, but the not-connected phrasing must defer ("once").
      expect(notConnected).toContain("once the owner connects");
    });

    it("asserts email delivery only when email is connected", () => {
      const connected = buildCapabilityBoundary(["x", "email"]).toLowerCase();
      const notConnected = buildCapabilityBoundary(["x"]).toLowerCase();
      expect(connected).toContain("email");
      // The email line must appear in both, but unconnected defers it.
      expect(notConnected).toContain("email");
      expect(notConnected).toMatch(/once the owner connects (their mailbox|email)/);
    });

    it("adds a monetization/Stripe line only when stripe is connected", () => {
      const connected = buildCapabilityBoundary(["x", "stripe"]).toLowerCase();
      const notConnected = buildCapabilityBoundary(["x"]).toLowerCase();
      expect(connected).toContain("stripe");
      expect(connected).toMatch(/charge|payment|monetiz/);
      // Stripe must still APPEAR when not connected (pricing is mandatory) but as
      // a deferred capability.
      expect(notConnected).toContain("stripe");
      expect(notConnected).toMatch(/stripe[\s\S]{0,80}once the owner connects/);
    });

    it("does not assert build/email/charge as already-doable when nothing is connected", () => {
      const text = buildCapabilityBoundary([]).toLowerCase();
      // The deferred framing ("available once the owner connects") must be present
      // for each capability rather than a flat assertion.
      const occurrences = (text.match(/once the owner connects/g) ?? []).length;
      expect(occurrences).toBeGreaterThanOrEqual(3);
    });
  });
});
