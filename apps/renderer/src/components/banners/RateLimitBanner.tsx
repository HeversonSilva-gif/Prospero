import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

// Shows while the Max account is rate-limited and the whole team is parked.
// Reads the persisted gate (settings.rateLimitedUntil) rather than a transient
// event, so it is restart-safe: on launch it reflects the real state and clears
// itself once the team auto-resumes (the gate is set back to null server-side).
const POLL_MS = 10_000;
const TICK_MS = 30_000;

export const RateLimitBanner: FC = () => {
  const { t } = useTranslation();
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void window.prospero.settings.get().then((s) => {
        if (!cancelled) setUntil(s.rateLimitedUntil);
      });
    };
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    // Re-render periodically so the banner self-hides at the reset time even if
    // the server-side clear lags behind.
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    // Appear promptly when the team is parked (don't wait a full poll).
    const off = window.prospero.agents.onEvent((ev) => {
      if (ev.kind === "status-changed" && ev.status === "paused") refresh();
    });
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
      off();
    };
  }, []);

  if (until === null || now >= until) return null;

  return (
    <div className="bg-semantic-warning text-ink px-4 py-2 text-sm">
      {t("banners.rateLimit.message", { time: new Date(until).toLocaleString() })}
    </div>
  );
};
