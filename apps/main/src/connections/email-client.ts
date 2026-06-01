// Pure email logic with INJECTED I/O so it is unit-testable without a live mailbox.
// Resend uses plain HTTP (testable); SMTP send/verify + IMAP read are injected functions
// whose production implementations (nodemailer/imapflow) live in email-transports.ts. The
// owner's credentials are passed in `payload` and NEVER logged.

export type SmtpPayload = {
  mode: "smtp";
  from: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  imapHost: string;
  imapPort: number;
};
export type ResendPayload = { mode: "resend"; from: string; apiKey: string };
export type EmailPayload = SmtpPayload | ResendPayload;

export type EmailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
};

export type InboundEmail = {
  from: string;
  subject: string;
  snippet: string;
  date: string;
  messageId: string;
};

export type EmailHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export type SmtpMessage = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
};
export type SmtpSendFn = (p: SmtpPayload, m: SmtpMessage) => Promise<{ messageId: string }>;
export type SmtpVerifyFn = (p: SmtpPayload) => Promise<void>;
export type ImapFetchFn = (p: SmtpPayload, limit: number) => Promise<InboundEmail[]>;

export type EmailDeps = {
  http: EmailHttp;
  smtpSend: SmtpSendFn;
  smtpVerify: SmtpVerifyFn;
  imapFetch: ImapFetchFn;
};

export class EmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

const toArray = (to: string | string[]): string[] => (Array.isArray(to) ? to : [to]);

const threadHeaders = (inReplyTo: string | undefined): Record<string, string> | undefined =>
  inReplyTo !== undefined ? { "In-Reply-To": inReplyTo, References: inReplyTo } : undefined;

export const sendEmail = async (
  deps: EmailDeps,
  payload: EmailPayload,
  msg: EmailMessage,
): Promise<{ messageId: string }> => {
  const headers = threadHeaders(msg.inReplyTo);
  if (payload.mode === "resend") {
    const body = {
      from: payload.from,
      to: toArray(msg.to),
      subject: msg.subject,
      text: msg.text,
      ...(msg.html !== undefined ? { html: msg.html } : {}),
      ...(headers !== undefined ? { headers } : {}),
    };
    const res = await deps.http("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${payload.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { id?: string; message?: string };
    if (res.status >= 400 || data.id === undefined) {
      throw new EmailError(res.status, data.message ?? `Resend API error ${String(res.status)}`);
    }
    return { messageId: data.id };
  }
  return deps.smtpSend(payload, {
    to: toArray(msg.to),
    subject: msg.subject,
    text: msg.text,
    ...(msg.html !== undefined ? { html: msg.html } : {}),
    ...(headers !== undefined ? { headers } : {}),
  });
};

export const readRecentEmails = async (
  deps: EmailDeps,
  payload: EmailPayload,
  limit = 10,
): Promise<InboundEmail[]> => {
  if (payload.mode === "resend") {
    throw new EmailError(400, "Leitura de e-mails recebidos indisponível no modo Resend.");
  }
  return deps.imapFetch(payload, limit);
};

export const verifyConnection = async (deps: EmailDeps, payload: EmailPayload): Promise<void> => {
  if (payload.mode === "resend") {
    // Resend has no cheap validate endpoint that works for send-ONLY keys (a /domains
    // probe 401/403s on correctly-scoped sending keys), so accept a well-formed `re_`
    // key here; the first real send surfaces an auth error if it's wrong.
    if (!payload.apiKey.startsWith("re_")) {
      throw new EmailError(400, "Chave Resend inválida (deve começar com re_).");
    }
    return Promise.resolve();
  }
  await deps.smtpVerify(payload);
};
