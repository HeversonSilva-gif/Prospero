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
  // The full reference chain (space-separated Message-Ids) of the thread being replied
  // to, so the new References header can accumulate instead of resetting the chain (M6).
  references?: string;
  // Stable per-send key (derived from the requestId / approval id at the call site) used
  // for idempotency: Resend `Idempotency-Key` header + a deterministic SMTP Message-ID, so
  // a deferred re-attempt / 60s-timeout retry does not double-send (I4). Optional — when
  // absent the transport falls back to its own generated id (back-compat).
  idempotencyKey?: string;
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

// Bounds untrusted email body text into a snippet the injection guard can scan (C2).
// The production IMAP fetch only pulled the envelope (snippet always ""), so the guard
// never saw the real injection vector — the body. Keep it bounded (don't load huge
// HTML/attachments wholesale) and fail-soft: non-string input yields "".
export const extractBodySnippet = (raw: unknown, maxBytes = 4096): string => {
  if (typeof raw !== "string" || raw === "") return "";
  return raw.slice(0, maxBytes);
};

// Builds threading headers. References must ACCUMULATE the chain (prior references +
// the parent's Message-Id) so replies stay grouped (M6); In-Reply-To is the parent only.
const threadHeaders = (
  inReplyTo: string | undefined,
  references: string | undefined,
): Record<string, string> | undefined => {
  if (inReplyTo === undefined) return undefined;
  const chain =
    references !== undefined && references.trim() !== ""
      ? `${references.trim()} ${inReplyTo}`
      : inReplyTo;
  return { "In-Reply-To": inReplyTo, References: chain };
};

// Deterministic Message-ID derived from the stable idempotency key, so a re-attempt
// of the SAME send carries the SAME Message-ID — downstream/relay dedup can collapse it.
const messageIdFor = (key: string): string => `<${key}@prospero.local>`;

export const sendEmail = async (
  deps: EmailDeps,
  payload: EmailPayload,
  msg: EmailMessage,
): Promise<{ messageId: string }> => {
  const headers = threadHeaders(msg.inReplyTo, msg.references);
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
      headers: {
        Authorization: `Bearer ${payload.apiKey}`,
        "Content-Type": "application/json",
        // Resend dedups identical requests sharing this key (I4).
        ...(msg.idempotencyKey !== undefined ? { "Idempotency-Key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { id?: string; message?: string };
    if (res.status >= 400 || data.id === undefined) {
      throw new EmailError(res.status, data.message ?? `Resend API error ${String(res.status)}`);
    }
    return { messageId: data.id };
  }
  // SMTP has no idempotency API; a stable Message-ID is the closest equivalent (I4).
  const smtpHeaders: Record<string, string> = {
    ...(headers ?? {}),
    ...(msg.idempotencyKey !== undefined ? { "Message-ID": messageIdFor(msg.idempotencyKey) } : {}),
  };
  return deps.smtpSend(payload, {
    to: toArray(msg.to),
    subject: msg.subject,
    text: msg.text,
    ...(msg.html !== undefined ? { html: msg.html } : {}),
    ...(Object.keys(smtpHeaders).length > 0 ? { headers: smtpHeaders } : {}),
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
    // key here; the first real send surfaces an auth error if it's wrong. Tighter than a
    // bare startsWith("re_") — require an actual token body after the prefix (M6) so
    // `re_` / `re_   ` are rejected.
    if (!/^re_[A-Za-z0-9]{3,}$/.test(payload.apiKey)) {
      throw new EmailError(400, "Chave Resend inválida (deve começar com re_).");
    }
    return Promise.resolve();
  }
  await deps.smtpVerify(payload);
};
