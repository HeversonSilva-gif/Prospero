import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth.js";
import { daysUntil, isExpiringSoon } from "../../lib/oauth-expiry.js";

export const OAuthExpiryBanner: FC = () => {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);

  if (!status.hasToken) return null;
  // Auto-detected OAuth refreshes itself: the Claude CLI rotates the short-lived
  // access token using the refresh token in the credentials file, which both the
  // agent conversations and the headless background runs read. Its access-token
  // expiry (~1 day) is therefore not an actionable warning — surfacing it just
  // false-alarms every day. A genuinely broken credential surfaces via
  // AuthErrorBanner on the next run instead.
  if (status.source === "auto-detect") return null;
  const now = Date.now();
  if (!isExpiringSoon(status.expiresAt, now)) return null;

  const days = daysUntil(status.expiresAt, now) ?? 0;

  return (
    <div className="bg-semantic-warning text-ink px-4 py-2 text-sm flex items-center justify-between">
      <span>{t("banners.oauthExpiry.message", { count: days })}</span>
      <Link to="/settings" className="underline font-semibold hover:opacity-90">
        {t("banners.oauthExpiry.action")}
      </Link>
    </div>
  );
};
