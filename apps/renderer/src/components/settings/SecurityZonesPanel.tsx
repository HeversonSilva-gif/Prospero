import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import type { ZoneSummary } from "@prospero/shared";

// M13 PR-E containment zones — read-only transparency panel for Settings
// (spec §9 + §13 row "Settings → Segurança"). One row per company zone +
// one per agent zone, with the sample path. The zone authority is
// apps/main/src/security/zones.ts; this surface is purely informational.

export const SecurityZonesPanel: FC = () => {
  const { t } = useTranslation();
  const [zones, setZones] = useState<ZoneSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.prospero.security.listZones();
        setZones(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("settings.security.title")}
      </h2>
      <p className="text-xs text-ink-muted mb-3">{t("settings.security.subtitle")}</p>

      {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
      {error === null && zones === null && (
        <p className="text-xs text-ink-muted">{t("settings.security.loading")}</p>
      )}
      {error === null && zones !== null && zones.length === 0 && (
        <p className="text-xs text-ink-muted">{t("settings.security.empty")}</p>
      )}
      {error === null && zones !== null && zones.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-ink-muted">
              <tr className="text-left">
                <th className="py-1 pr-3 font-semibold">{t("settings.security.kind")}</th>
                <th className="py-1 pr-3 font-semibold">{t("settings.security.company")}</th>
                <th className="py-1 pr-3 font-semibold">{t("settings.security.agent")}</th>
                <th className="py-1 font-semibold">{t("settings.security.path")}</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {zones.map((z, i) => (
                <tr
                  key={`${z.kind}:${z.companyId}:${z.kind === "agent" ? z.agentId : ""}:${i}`}
                  className="border-t border-surface-border align-top"
                >
                  <td className="py-1 pr-3 font-mono">{z.kind}</td>
                  <td className="py-1 pr-3">{z.companyName}</td>
                  <td className="py-1 pr-3">{z.kind === "agent" ? z.agentName : "—"}</td>
                  <td className="py-1 font-mono text-ink-muted break-all">{z.samplePath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
