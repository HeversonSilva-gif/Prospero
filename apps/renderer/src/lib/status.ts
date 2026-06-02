export type StatusTone = "active" | "wait" | "idle" | "error";

export type StatusInfo = {
  tone: StatusTone;
  /** i18n key for the status label (e.g. "agentStatus.working") */
  labelKey: string;
  /** tailwind text color class */
  textClass: string;
  /** tailwind background color class for the dot */
  dotClass: string;
  /** inline box-shadow halo (rgba) matching the tone */
  halo: string;
};

// Maps the real AgentStatus union to Estúdio tones.
// working/thinking -> active (jade); waiting/paused -> wait (amber);
// error -> error (danger); idle/terminated/unknown -> idle (grey).
const toneOf = (status: string): StatusTone => {
  switch (status) {
    case "working":
    case "thinking":
      return "active";
    case "waiting":
    case "paused":
      return "wait";
    case "error":
      return "error";
    default:
      return "idle";
  }
};

const KNOWN = new Set(["working", "thinking", "idle", "waiting", "paused", "error", "terminated"]);

const BY_TONE: Record<StatusTone, Omit<StatusInfo, "tone" | "labelKey">> = {
  active: {
    textClass: "text-status-active",
    dotClass: "bg-status-active",
    halo: "rgba(15,118,110,.15)",
  },
  wait: { textClass: "text-status-wait", dotClass: "bg-status-wait", halo: "rgba(217,162,27,.18)" },
  idle: {
    textClass: "text-status-idle",
    dotClass: "bg-status-idle",
    halo: "rgba(155,176,167,.18)",
  },
  error: {
    textClass: "text-semantic-danger",
    dotClass: "bg-semantic-danger",
    halo: "rgba(232,56,56,.18)",
  },
};

export const agentStatusInfo = (status: string): StatusInfo => {
  const tone = toneOf(status);
  const labelKey = `agentStatus.${KNOWN.has(status) ? status : "idle"}`;
  return { tone, labelKey, ...BY_TONE[tone] };
};
