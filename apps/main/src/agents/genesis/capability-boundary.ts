// What the AI team can build/operate/maintain UNAIDED, and what it cannot. Fed
// into the CEO's genesis prompt and the business-plan critic so proposals stay
// inside the system's real reach (INV-2). Capability lines are keyed off the
// connectors actually available, so the prose never asserts a capability the
// owner has not wired yet (INV-1) — an unconnected capability is phrased as
// "available once the owner connects X" rather than as something the CEO can
// already do. Pure — the wiring passes in the real channel/connector list.

export const buildCapabilityBoundary = (availableChannels: string[]): string => {
  const has = (c: string): boolean => availableChannels.includes(c);

  // Each capability line is either asserted (connector connected) or deferred
  // (phrased as "available once the owner connects X"). The deferred phrasing is
  // shared so the critic + prompt can both recognise the boundary.
  const hosting = has("cloudflare")
    ? "- Hosting (Cloudflare): deploy and run a full-stack web app (front-end + serverless\n  functions + a database) on a free tier — the owner has connected Cloudflare."
    : "- Hosting (Cloudflare): deploying a full-stack web app is available once the owner connects\n  Cloudflare in Ajustes — until then, plan as if it is not yet wired.";

  const email = has("email")
    ? "- Email (mailbox): deliver the product/access to a buyer after a sale, reply to\n  customers, and follow up opted-in leads — the owner has connected their mailbox."
    : "- Email (mailbox): delivering the product, replying to customers, and following up leads\n  is available once the owner connects their mailbox in Ajustes.";

  const monetization = has("stripe")
    ? "- Monetization (Stripe): charge customers and take payments — the owner has connected\n  Stripe, so enact the plan's pricing as products/prices and a payment link."
    : "- Monetization (Stripe): charging customers and taking payments is available\n  once the owner connects Stripe in Ajustes — still set concrete pricing in the plan\n  so the team can enact it the moment Stripe is connected.";

  const lines = [
    "## What your AI team can build, run, and maintain on its own",
    "",
    "Only propose a business your team can deliver AND keep running with no human",
    "hands. Your team is strong at:",
    "- Software / SaaS: writing, shipping, and maintaining web apps and automations.",
    hosting,
    email,
    monetization,
    "- Writing: posts, copy, articles, scripts, structured text.",
    "- Organization & automation: workflows, scheduling, data wrangling, ops.",
    "",
    "Your team CANNOT reliably do these alone — do NOT propose a business that depends on them:",
    "- Good visual design (logos, illustrated e-books, polished graphics).",
    "- Anything physical, or manual fulfillment that needs a person.",
    "- Work requiring the owner's hands, money up front, or offline presence.",
    "",
    "Marketing channels you can operate now:",
  ];
  if (has("x")) {
    lines.push(
      "- X (text): your first marketing channel. The BUSINESS is not an X account —",
      "  X is just the first door to reach people. Other channels arrive later.",
    );
  } else {
    lines.push("- (none connected yet — keep marketing channel-agnostic in the plan).");
  }
  return lines.join("\n");
};
