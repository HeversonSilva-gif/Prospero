export type TokenSource = "manual" | "auto-detect";

export type TokenStatus =
  | { hasToken: false }
  | {
      hasToken: true;
      source: TokenSource;
      maskedPrefix: string;
      configuredAt: number;
    };
