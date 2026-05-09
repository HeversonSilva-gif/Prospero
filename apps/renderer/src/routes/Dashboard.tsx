import { useTranslation } from "react-i18next";

export const Dashboard = () => {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-brand-dark">{t("app.title")}</h1>
      <p className="text-ink-muted mt-2">
        M2 — Auth & Settings done. Dashboard widgets land in M6.
      </p>
    </div>
  );
};
