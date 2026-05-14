export const EXPIRY_WARN_DAYS = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const daysUntil = (expiresAt: number | null, now: number): number | null => {
  if (expiresAt === null) return null;
  const diff = expiresAt - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / ONE_DAY_MS);
};

export const isExpiringSoon = (expiresAt: number | null, now: number): boolean => {
  const days = daysUntil(expiresAt, now);
  return days !== null && days <= EXPIRY_WARN_DAYS;
};
