export type TokenSource = "manual" | "auto-detect";

export type TokenStatus =
  | { hasToken: false }
  | {
      hasToken: true;
      source: TokenSource;
      maskedPrefix: string;
      configuredAt: number;
      expiresAt: number | null;
    };

export type DetectResult = { found: false } | { found: true; maskedPrefix: string };

export type ApiKeyStatus =
  | { hasKey: false }
  | { hasKey: true; maskedPrefix: string; configuredAt: number };

export type RecoveryReason = "user-reconnect" | "auto-401";

export type RecoveryResult =
  | { kind: "recovered"; agentId: string; durationMs: number }
  | { kind: "host-stale"; agentId: string; reason: "no-host-file" | "host-malformed" }
  | { kind: "skipped-not-running"; agentId: string }
  | { kind: "skipped-recovering"; agentId: string }
  | { kind: "skipped-cooldown"; agentId: string }
  | { kind: "failed"; agentId: string; reason: string };

export type RecoveryStatusEvent = {
  agentId: string;
  phase: "started" | "recovered" | "host-stale" | "failed";
  reason?: string;
};
