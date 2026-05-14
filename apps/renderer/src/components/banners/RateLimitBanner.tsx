import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

type State = { active: boolean; retryAt: number | null; message: string };

const initial: State = { active: false, retryAt: null, message: "" };

export const RateLimitBanner: FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<State>(initial);

  useEffect(() => {
    const off = window.dashboardAgent.agents.onEvent((ev) => {
      if (ev.kind !== "rate-limited") return;
      const retryAt =
        ev.retryAfterSec !== null && ev.retryAfterSec > 0
          ? Date.now() + ev.retryAfterSec * 1000
          : null;
      setState({ active: true, retryAt, message: ev.message });
    });
    return off;
  }, []);

  // Auto-clear after the retry window (or 60s fallback).
  useEffect(() => {
    if (!state.active) return;
    const ms = state.retryAt !== null ? Math.max(0, state.retryAt - Date.now()) : 60_000;
    const timer = setTimeout(() => setState(initial), ms);
    return () => clearTimeout(timer);
  }, [state]);

  if (!state.active) return null;

  return (
    <div className="bg-semantic-warning text-ink px-4 py-2 text-sm">
      {t("banners.rateLimit.message")} — {state.message}
    </div>
  );
};
