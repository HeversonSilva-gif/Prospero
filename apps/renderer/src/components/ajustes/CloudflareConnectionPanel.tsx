import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../../stores/companies.js";

// Deploy hand (D.1) — "Conectar Cloudflare" panel in Ajustes › Conta. The user pastes
// their OWN scoped Cloudflare API token and clicks Conectar; the main process validates
// it (reads the account) and stores it encrypted locally. Strings use t() defaultValue
// (PT) to avoid i18n-parity churn. The token is never shown back or logged.
export const CloudflareConnectionPanel: FC = () => {
  const { t } = useTranslation();
  const companyId = useCompaniesStore((s) => s.activeId);
  const [status, setStatus] = useState<{ connected: boolean; account?: string }>({
    connected: false,
  });
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyId === null) return;
    let cancelled = false;
    void window.prospero.connections.cloudflareStatus(companyId).then((s) => {
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
      const res = await window.prospero.connections.cloudflareConnect(companyId, token.trim());
      if (res.connected) {
        setStatus({
          connected: true,
          ...(res.account !== undefined ? { account: res.account } : {}),
        });
        setToken("");
      } else {
        setError(
          res.error ??
            t("connections.cloudflare.error", { defaultValue: "Falha ao conectar o Cloudflare." }),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    await window.prospero.connections.cloudflareDisconnect(companyId);
    setStatus({ connected: false });
  };

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("connections.cloudflare.title", { defaultValue: "Conta do Cloudflare (hospedagem)" })}
      </h2>
      <p className="text-xs text-ink-muted mb-3">
        {t("connections.cloudflare.subtitle", {
          defaultValue:
            "Conecte sua conta Cloudflare para a equipe publicar o produto (site/app) — produção passa pela sua aprovação.",
        })}
      </p>
      {status.connected ? (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            {t("connections.cloudflare.connectedAs", { defaultValue: "Conectado" })}:{" "}
            <code>{status.account ?? "—"}</code>
          </p>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-sm text-semantic-danger hover:underline"
          >
            {t("connections.cloudflare.disconnect", { defaultValue: "Desconectar" })}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t("connections.cloudflare.tokenPlaceholder", {
              defaultValue: "API token do Cloudflare",
            })}
            disabled={busy}
            className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
          />
          {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
          <p className="text-xs text-ink-muted">
            {t("connections.cloudflare.hint", {
              defaultValue:
                "No painel da Cloudflare (Meu Perfil › Tokens de API › Criar token), crie um token com permissão de edição em Workers Scripts, Cloudflare Pages, D1 e R2, e leitura em Account Settings. Cole o token e clique em Conectar.",
            })}
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || token.trim().length === 0}
            className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
          >
            {busy
              ? t("connections.cloudflare.connecting", { defaultValue: "Conectando…" })
              : t("connections.cloudflare.connect", { defaultValue: "Conectar Cloudflare" })}
          </button>
        </div>
      )}
    </section>
  );
};
