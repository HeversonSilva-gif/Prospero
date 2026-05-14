import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../stores/auth.js";

export const AuthErrorBanner: FC = () => {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);
  const apiKeyStatus = useAuthStore((s) => s.apiKeyStatus);
  const loaded = useAuthStore((s) => s.loaded);

  // Wait until auth has loaded before deciding. Avoids flash on cold start.
  if (!loaded) return null;
  if (status.hasToken || apiKeyStatus.hasKey) return null;

  return (
    <div className="bg-semantic-danger text-white px-4 py-2 text-sm flex items-center justify-between">
      <span>{t("banners.authError.message")}</span>
      <Link to="/setup" className="underline font-semibold text-white hover:opacity-90">
        {t("banners.authError.action")}
      </Link>
    </div>
  );
};
