export type TokenSource = "manual" | "auto-detect";

export type TokenStatus =
  | { hasToken: false }
  | {
      hasToken: true;
      source: TokenSource;
      maskedPrefix: string;
      configuredAt: number;
    };

export type DetectResult = { found: false } | { found: true; maskedPrefix: string };

export type ApiKeyStatus =
  | { hasKey: false }
  | { hasKey: true; maskedPrefix: string; configuredAt: number };
