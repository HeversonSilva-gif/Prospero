import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../../stores/companies.js";

// 0.2.X P5.1 — "Conectar Stripe" panel in Ajustes › Conta. The user pastes their OWN
// Stripe RESTRICTED key (rk_…) and clicks Conectar; the main process validates it
// (reads the account) and stores it encrypted locally. Strings use t() defaultValue
// (PT) to avoid i18n-parity churn — the app is PT-first. Money is never moved here.
export const StripeConnectionPanel: FC = () => {
  const { t } = useTranslation();
  const companyId = useCompaniesStore((s) => s.activeId);
  const [status, setStatus] = useState<{
    connected: boolean;
    account?: string;
    livemode?: boolean;
  }>({ connected: false });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyId === null) return;
    let cancelled = false;
    void window.prospero.connections.stripeStatus(companyId).then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (companyId === null) return null;

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.prospero.connections.stripeConnect(companyId, key.trim());
      if (res.connected) {
        setStatus({
          connected: true,
          ...(res.account !== undefined ? { account: res.account } : {}),
          ...(res.livemode !== undefined ? { livemode: res.livemode } : {}),
        });
        setKey("");
      } else {
        setError(
          res.error ??
            t("connections.stripe.error", { defaultValue: "Falha ao conectar o Stripe." }),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    await window.prospero.connections.stripeDisconnect(companyId);
    setStatus({ connected: false });
  };

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("connections.stripe.title", { defaultValue: "Conta do Stripe (pagamentos)" })}
      </h2>
      <p className="text-xs text-ink-muted mb-3">
        {t("connections.stripe.subtitle", {
          defaultValue:
            "Conecte sua conta Stripe para o negócio cobrar e receber — sempre passando pela sua aprovação.",
        })}
      </p>
      {status.connected ? (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            {t("connections.stripe.connectedAs", { defaultValue: "Conectado" })}:{" "}
            <code>{status.account ?? "—"}</code>
            {status.livemode === false && (
              <span className="ml-2 text-[10px] uppercase tracking-wide bg-surface-soft text-ink-muted px-1.5 py-0.5 rounded">
                {t("connections.stripe.testMode", { defaultValue: "modo teste" })}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-sm text-semantic-danger hover:underline"
          >
            {t("connections.stripe.disconnect", { defaultValue: "Desconectar" })}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("connections.stripe.keyPlaceholder", {
              defaultValue: "Chave restrita do Stripe (rk_…)",
            })}
            disabled={busy}
            className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
          />
          {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
          <p className="text-xs text-ink-muted">
            {t("connections.stripe.hint", {
              defaultValue:
                "No painel da Stripe (Desenvolvedores › Chaves de API), crie uma chave restrita com permissão de escrita em Produtos, Preços, Payment Links e Checkout, e leitura em Saldo e Cobranças. Cole a chave rk_… e clique em Conectar.",
            })}
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || key.trim().length === 0}
            className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
          >
            {busy
              ? t("connections.stripe.connecting", { defaultValue: "Conectando…" })
              : t("connections.stripe.connect", { defaultValue: "Conectar Stripe" })}
          </button>
        </div>
      )}
    </section>
  );
};
