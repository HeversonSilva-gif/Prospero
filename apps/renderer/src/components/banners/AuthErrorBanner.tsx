import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth.js";

export const AuthErrorBanner: FC = () => {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);
  const apiKeyStatus = useAuthStore((s) => s.apiKeyStatus);
  const loaded = useAuthStore((s) => s.loaded);
  const [hostStale, setHostStale] = useState(false);

  useEffect(() => {
    const unsub = window.prospero.auth.onRecoveryStatus((event) => {
      if (event.phase === "host-stale") {
        setHostStale(true);
      } else if (event.phase === "recovered") {
        setHostStale(false);
      }
    });
    return unsub;
  }, []);

  // Wait until auth has loaded before deciding. Avoids flash on cold start.
  if (!loaded) return null;
  const noToken = !status.hasToken && !apiKeyStatus.hasKey;

  if (!noToken && !hostStale) return null;

  const message = hostStale ? t("banners.recoveryFailedHostStale") : t("banners.authError.message");
  const actionLabel = t("banners.authError.action");

  return (
    <div className="bg-semantic-danger text-white px-4 py-2 text-sm flex items-center justify-between">
      <span>{message}</span>
      <Link to="/setup" className="underline font-semibold text-white hover:opacity-90">
        {actionLabel}
      </Link>
    </div>
  );
};
