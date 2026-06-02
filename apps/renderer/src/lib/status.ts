export type StatusTone = "active" | "wait" | "idle";

export type StatusInfo = {
  tone: StatusTone;
  /** tailwind text color class */
  textClass: string;
  /** tailwind background color class for the dot */
  dotClass: string;
};

// Maps the many agent statuses to the 3 Estúdio tones (jade / amber / grey).
export const agentStatusInfo = (status: string): StatusInfo => {
  const tone: StatusTone =
    status === "active" || status === "working" || status === "writing"
      ? "active"
      : status === "waiting" || status === "blocked"
        ? "wait"
        : "idle";
  const byTone: Record<StatusTone, Omit<StatusInfo, "tone">> = {
    active: { textClass: "text-status-active", dotClass: "bg-status-active" },
    wait: { textClass: "text-status-wait", dotClass: "bg-status-wait" },
    idle: { textClass: "text-status-idle", dotClass: "bg-status-idle" },
  };
  return { tone, ...byTone[tone] };
};
