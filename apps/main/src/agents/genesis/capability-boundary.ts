// What the AI team can build/operate/maintain UNAIDED, and what it cannot. Fed
// into the CEO's genesis prompt and the business-plan critic so proposals stay
// inside the system's real reach (INV-2). Channel lines are keyed off the
// connectors actually available, so the prose never promises a channel that
// isn't wired (INV-1). Pure — the wiring passes in the real channel list.

export const buildCapabilityBoundary = (availableChannels: string[]): string => {
  const lines = [
    "## What your AI team can build, run, and maintain on its own",
    "",
    "Only propose a business your team can deliver AND keep running with no human",
    "hands. Your team is strong at:",
    "- Software / SaaS: writing, shipping, and maintaining web apps and automations.",
    "- Writing: posts, copy, articles, scripts, structured text.",
    "- Organization & automation: workflows, scheduling, data wrangling, ops.",
    "",
    "Your team CANNOT reliably do these alone — do NOT propose a business that depends on them:",
    "- Good visual design (logos, illustrated e-books, polished graphics).",
    "- Anything physical, or manual fulfillment / hosting that needs a person.",
    "- Work requiring the owner's hands, money up front, or offline presence.",
    "",
    "Marketing channels you can operate now:",
  ];
  if (availableChannels.includes("x")) {
    lines.push(
      "- X (text): your first marketing channel. The BUSINESS is not an X account —",
      "  X is just the first door to reach people. Other channels arrive later.",
    );
  } else {
    lines.push("- (none connected yet — keep marketing channel-agnostic in the plan).");
  }
  return lines.join("\n");
};
