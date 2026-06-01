import { useEffect, useState, type ChangeEvent, type FC } from "react";
import { useTranslation } from "react-i18next";
import { useCompaniesStore } from "../../stores/companies.js";

// Email hand (E.1) — "Conectar e-mail" panel in Ajustes › Conta. The owner connects their
// OWN mailbox (SMTP/IMAP) or a Resend API key. The main process validates and stores it
// encrypted. Strings use t() defaultValue (PT). Credentials are never shown back or logged.
export const EmailConnectionPanel: FC = () => {
  const { t } = useTranslation();
  const companyId = useCompaniesStore((s) => s.activeId);
  const [status, setStatus] = useState<{ connected: boolean; mode?: string; from?: string }>({
    connected: false,
  });
  const [mode, setMode] = useState<"smtp" | "resend">("smtp");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyId === null) return;
    let cancelled = false;
    void window.prospero.connections.emailStatus(companyId).then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (companyId === null) return null;

  const set = (k: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const connection: Record<string, unknown> =
      mode === "resend"
        ? { mode: "resend", from: f.from ?? "", apiKey: f.apiKey ?? "" }
        : {
            mode: "smtp",
            from: f.from ?? "",
            smtpHost: f.smtpHost ?? "",
            smtpPort: Number(f.smtpPort ?? "465"),
            smtpSecure: true,
            smtpUser: f.smtpUser ?? f.from ?? "",
            smtpPass: f.smtpPass ?? "",
            imapHost: f.imapHost ?? "",
            imapPort: Number(f.imapPort ?? "993"),
          };
    try {
      const res = await window.prospero.connections.emailConnect(companyId, connection);
      if (res.connected) {
        setStatus({
          connected: true,
          ...(res.mode !== undefined ? { mode: res.mode } : {}),
          ...(res.from !== undefined ? { from: res.from } : {}),
        });
        setF({});
      } else {
        setError(res.error ?? t("connections.email.error", { defaultValue: "Falha ao conectar." }));
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    await window.prospero.connections.emailDisconnect(companyId);
    setStatus({ connected: false });
  };

  const field = (key: string, label: string, type = "text") => (
    <input
      type={type}
      autoComplete="off"
      spellCheck={false}
      value={f[key] ?? ""}
      onChange={set(key)}
      placeholder={label}
      disabled={busy}
      className="w-full px-3 py-2 bg-surface-soft border border-surface-border rounded text-sm"
    />
  );

  return (
    <section className="bg-surface-card border border-surface-border rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-brand-dark mb-2">
        {t("connections.email.title", { defaultValue: "E-mail (entrega + respostas)" })}
      </h2>
      <p className="text-xs text-ink-muted mb-3">
        {t("connections.email.subtitle", {
          defaultValue:
            "Conecte seu e-mail para a equipe entregar ao comprador e responder clientes — cada envio passa pela sua aprovação.",
        })}
      </p>
      {status.connected ? (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            {t("connections.email.connectedAs", { defaultValue: "Conectado" })}:{" "}
            <code>{status.from ?? "—"}</code>{" "}
            <span className="text-xs text-ink-muted">({status.mode ?? "smtp"})</span>
          </p>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-sm text-semantic-danger hover:underline"
          >
            {t("connections.email.disconnect", { defaultValue: "Desconectar" })}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setMode("smtp")}
              className={`px-3 py-1 rounded border ${mode === "smtp" ? "border-brand text-brand" : "border-surface-border text-ink-muted"}`}
            >
              SMTP / IMAP
            </button>
            <button
              type="button"
              onClick={() => setMode("resend")}
              className={`px-3 py-1 rounded border ${mode === "resend" ? "border-brand text-brand" : "border-surface-border text-ink-muted"}`}
            >
              Resend
            </button>
          </div>
          {field("from", t("connections.email.from", { defaultValue: "Seu e-mail (from)" }))}
          {mode === "resend" ? (
            field(
              "apiKey",
              t("connections.email.apiKey", { defaultValue: "Resend API key" }),
              "password",
            )
          ) : (
            <>
              {field(
                "smtpHost",
                t("connections.email.smtpHost", {
                  defaultValue: "Servidor SMTP (ex.: smtp.gmail.com)",
                }),
              )}
              {field(
                "smtpPort",
                t("connections.email.smtpPort", { defaultValue: "Porta SMTP (465)" }),
              )}
              {field(
                "smtpUser",
                t("connections.email.smtpUser", { defaultValue: "Usuário SMTP (seu e-mail)" }),
              )}
              {field(
                "smtpPass",
                t("connections.email.smtpPass", { defaultValue: "Senha de app" }),
                "password",
              )}
              {field(
                "imapHost",
                t("connections.email.imapHost", {
                  defaultValue: "Servidor IMAP (ex.: imap.gmail.com)",
                }),
              )}
              {field(
                "imapPort",
                t("connections.email.imapPort", { defaultValue: "Porta IMAP (993)" }),
              )}
            </>
          )}
          {error !== null && <p className="text-xs text-semantic-danger">{error}</p>}
          <p className="text-xs text-ink-muted">
            {t("connections.email.hint", {
              defaultValue:
                "Gmail: ative a verificação em 2 etapas e gere uma 'senha de app'. Resend: cole a API key (envia do seu domínio verificado).",
            })}
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="px-4 py-2 bg-brand text-brand-fg text-sm font-semibold rounded disabled:opacity-50"
          >
            {busy
              ? t("connections.email.connecting", { defaultValue: "Conectando…" })
              : t("connections.email.connect", { defaultValue: "Conectar e-mail" })}
          </button>
        </div>
      )}
    </section>
  );
};
