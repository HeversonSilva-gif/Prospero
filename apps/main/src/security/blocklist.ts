export const ALWAYS_BLOCKED = {
  bash: [
    /\bcurl\b.*-d\s+@/,
    /\bcurl\b.*-F\s+\w+=@/,
    /\bwget\b.*--post-file=/,
    /\b(nc|ncat)\b\s+\S+\s+\d+/,
    /\.credentials\.json/i,
    /[\\/]\.(ssh|aws|docker)([\\/]|$)/,
    /\brm\s+-rf\s+\/\s*$/,
    /\bdel\s+\/s\s+\/q/i,
    /\bgit\s+(reset\s+--hard|clean\s+-fdx)\b/,
    /\bformat\s+[a-z]:/i,
  ],
  pathPrefix: [
    /\.claude[\\/]/i,
    /\.ssh[\\/]/i,
    /\.aws[\\/]/i,
    /\.docker[\\/]/i,
    /AppData[\\/]Roaming[\\/]Microsoft[\\/]Credentials/i,
  ],
} as const;

export const matchesBlockedBash = (cmd: string): boolean =>
  ALWAYS_BLOCKED.bash.some((re) => re.test(cmd));

export const matchesBlockedPath = (path: string): boolean =>
  ALWAYS_BLOCKED.pathPrefix.some((re) => re.test(path));
