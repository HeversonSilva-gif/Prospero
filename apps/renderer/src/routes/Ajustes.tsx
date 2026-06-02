import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { XLogo, CreditCard, Cloud, EnvelopeSimple } from "@phosphor-icons/react";
import { useCompaniesStore } from "../stores/companies.js";
import { AjustesCard } from "../components/ajustes/AjustesCard.js";
import { ConnectorCard } from "../components/ajustes/ConnectorCard.js";
import {
  UserIcon,
  CreditCardIcon,
  SlidersIcon,
  WrenchIcon,
  ShieldIcon,
} from "../components/ajustes/ajustes-icons.js";

// Ajustes.tsx — Conexões hero (progress + 4 ConnectorCards) + Ajustes gerais (5 AjustesCards)

type ConnState = {
  x: { connected: boolean; handle?: string };
  stripe: { connected: boolean; account?: string; livemode?: boolean };
  cloudflare: { connected: boolean; account?: string };
  email: { connected: boolean; mode?: string; from?: string };
};

const DEFAULT_CONN: ConnState = {
  x: { connected: false },
  stripe: { connected: false },
  cloudflare: { connected: false },
  email: { connected: false },
};

export const Ajustes: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyId = useCompaniesStore((s) => s.activeId);
  const [conn, setConn] = useState<ConnState>(DEFAULT_CONN);

  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      try {
        const [x, stripe, cloudflare, email] = await Promise.all([
          window.prospero.connections.xStatus(companyId),
          window.prospero.connections.stripeStatus(companyId),
          window.prospero.connections.cloudflareStatus(companyId),
          window.prospero.connections.emailStatus(companyId),
        ]);
        setConn({ x, stripe, cloudflare, email });
      } catch {
        // best-effort — leave defaults
      }
    })();
  }, [companyId]);

  const connectedCount = [
    conn.x.connected,
    conn.stripe.connected,
    conn.cloudflare.connected,
    conn.email.connected,
  ].filter(Boolean).length;

  return (
    <div className="px-8 py-7 mx-auto max-w-3xl flex flex-col gap-7">
      <div>
        <h1 className="text-[25px] font-semibold tracking-[-0.025em] text-ink">
          {t("ajustes.title")}
        </h1>
        <p className="text-[13px] text-ink-muted mt-1">{t("ajustes.subtitle")}</p>
      </div>

      {/* Conexões section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-soft">
            {t("ajustes.conexoes.title")}
          </h2>
          <span className="font-mono text-[11px] text-ink-muted">
            {t("ajustes.conexoes.progress", { n: connectedCount })}
          </span>
        </div>
        <div className="h-1.5 rounded bg-surface-soft overflow-hidden my-2">
          <div className="h-full bg-brand" style={{ width: `${(connectedCount / 4) * 100}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ConnectorCard
            icon={<XLogo size={17} />}
            name="X"
            unlocks={t("ajustes.conexoes.unlocks.x")}
            connected={conn.x.connected}
            {...(conn.x.handle !== undefined ? { detail: conn.x.handle } : {})}
            onAction={() => navigate("/settings/conta")}
          />
          <ConnectorCard
            icon={<CreditCard size={17} />}
            name="Stripe"
            unlocks={t("ajustes.conexoes.unlocks.stripe")}
            connected={conn.stripe.connected}
            {...(conn.stripe.account !== undefined ? { detail: conn.stripe.account } : {})}
            onAction={() => navigate("/settings/conta")}
          />
          <ConnectorCard
            icon={<Cloud size={17} />}
            name="Cloudflare"
            unlocks={t("ajustes.conexoes.unlocks.cloudflare")}
            connected={conn.cloudflare.connected}
            {...(conn.cloudflare.account !== undefined ? { detail: conn.cloudflare.account } : {})}
            onAction={() => navigate("/settings/conta")}
          />
          <ConnectorCard
            icon={<EnvelopeSimple size={17} />}
            name="Email"
            unlocks={t("ajustes.conexoes.unlocks.email")}
            connected={conn.email.connected}
            {...(conn.email.from !== undefined ? { detail: conn.email.from } : {})}
            onAction={() => navigate("/settings/conta")}
          />
        </div>
      </div>

      {/* Ajustes gerais section */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-soft">
          {t("ajustes.gerais")}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <AjustesCard
            to="/settings/conta"
            icon={<UserIcon />}
            title={t("ajustes.conta.title")}
            sub={t("ajustes.conta.sub")}
          />
          <AjustesCard
            to="/costs"
            icon={<CreditCardIcon />}
            title={t("ajustes.gastos.title")}
            sub={t("ajustes.gastos.sub")}
          />
          <AjustesCard
            to="/settings/preferencias"
            icon={<SlidersIcon />}
            title={t("ajustes.preferencias.title")}
            sub={t("ajustes.preferencias.sub")}
          />
          <AjustesCard
            to="/settings/avancado"
            icon={<WrenchIcon />}
            title={t("ajustes.avancado.title")}
            sub={t("ajustes.avancado.sub")}
          />
          <AjustesCard
            to="/settings/governanca-assincrona"
            icon={<ShieldIcon />}
            title={t("settings.governance.cardTitle")}
            sub={t("settings.governance.cardSubtitle")}
          />
        </div>
      </div>
    </div>
  );
};
