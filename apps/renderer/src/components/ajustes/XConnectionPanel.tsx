import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../../stores/companies.js";

// 0.2.X P1 — "Conectar X" panel in Ajustes › Conta. The user pastes their OWN X app
// Client ID and clicks Conectar; the main process runs the OAuth loopback (opens the
// browser) and stores the tokens encrypted locally. Strings use t() defaultValue (PT)
// to avoid i18n-parity churn — the app is PT-first.
export const XConnectionPanel: FC = () => {
  const { t } = useTranslation();
  const companyId = useCompaniesStore((s) => s.activeId);
  const [status, setStatus] = useState<{ connected: boolean; handle?: string }>({
    connected: false,
  });
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyId === null) return;
    let cancelled = false;
    void window.prospero.connections.xStatus(companyId).then((s) => {
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
      const res = await window.prospero.connections.xConnect(companyId, clientId.trim());
      if (res.connected) {
        setStatus(
          res.handle !== undefined ? { connected: true, handle: res.handle } : { connected: true },
        );
        setClientId("");
      } else {
        setError(res.error ?? t("connections.x.error", { defaultValue: "Falha ao conectar o X." }));
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    await window.prospero.connections.xDisconnect(companyId);
    setStatus({ connected: false });
  };

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("connections.x.title", { defaultValue: "Conta do X (Twitter)" })}
      </h2>
      <p className="text-xs text-ink-muted mb-3">
        {t("connections.x.subtitle", {
          defaultValue:
            "Conecte uma conta do X para os agentes postarem e responderem — sempre passando pela sua aprovação.",
        })}
      </p>
      {status.connected ? (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            {t("connections.x.connectedAs", { defaultValue: "Conectado como" })}:{" "}
            <code>{status.handle ?? "—"}</code>
          </p>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-sm text-semantic-danger hover:underline"
          >
            {t("connections.x.disconnect", { defaultValue: "Desconectar" })}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={t("connections.x.clientIdPlaceholder", {
              defaultValue: "Client ID do seu app do X",
            })}
            disabled={busy}
            className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm font-mono"
          />
          {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
          <p className="text-xs text-ink-muted">
            {t("connections.x.hint", {
              defaultValue:
                "Crie um app em developer.x.com (Native/PKCE, Read+Write, callback http://127.0.0.1:8723/x/callback), cole o Client ID e clique em Conectar — abre o navegador para autorizar.",
            })}
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || clientId.trim().length === 0}
            className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
          >
            {busy
              ? t("connections.x.connecting", { defaultValue: "Conectando…" })
              : t("connections.x.connect", { defaultValue: "Conectar X" })}
          </button>
        </div>
      )}
    </section>
  );
};
