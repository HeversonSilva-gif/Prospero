import type { ConnectionsRepository } from "./connections-repository.js";
import {
  sendEmail,
  readRecentEmails,
  type EmailDeps,
  type EmailPayload,
  type InboundEmail,
} from "./email-client.js";

// Side-channel events the send_email / read_emails MCP tools emit (in the MCP child) so
// MAIN — the only side holding the safeStorage cipher to decrypt the mailbox credentials —
// does the actual SMTP/Resend/IMAP I/O. Never throws: a failure writes an `ok: false`
// result so the waiting tool resolves.

export type EmailSendEventPayload = {
  requestId: string;
  to: string | string[];
  subject: string;
  body: string;
  inReplyTo?: string;
};
export type EmailSendEventResult = { ok: true; messageId: string } | { ok: false; error: string };

export type EmailReadEventPayload = { requestId: string; limit?: number };
export type EmailReadEventResult =
  | { ok: true; emails: InboundEmail[] }
  | { ok: false; error: string };

// The decrypted connection payload IS an EmailPayload — narrow by its `mode` discriminator.
const loadEmailPayload = (repo: ConnectionsRepository, companyId: string): EmailPayload | null => {
  const conn = repo.load(companyId, "email");
  if (conn === null) return null;
  const p = conn.payload as { mode?: unknown };
  return p.mode === "smtp" || p.mode === "resend"
    ? (conn.payload as unknown as EmailPayload)
    : null;
};

const NOT_CONNECTED = "E-mail não conectado para esta empresa (conecte em Ajustes › Conta).";

export const handleEmailSendEvent = async (
  deps: {
    repo: ConnectionsRepository;
    emailDeps: EmailDeps;
    writeResult: (requestId: string, result: EmailSendEventResult) => void;
  },
  companyId: string,
  payload: EmailSendEventPayload,
): Promise<void> => {
  try {
    const email = loadEmailPayload(deps.repo, companyId);
    if (email === null) throw new Error(NOT_CONNECTED);
    const r = await sendEmail(deps.emailDeps, email, {
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      ...(payload.inReplyTo !== undefined ? { inReplyTo: payload.inReplyTo } : {}),
    });
    deps.writeResult(payload.requestId, { ok: true, messageId: r.messageId });
  } catch (e) {
    deps.writeResult(payload.requestId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

export const handleEmailReadEvent = async (
  deps: {
    repo: ConnectionsRepository;
    emailDeps: EmailDeps;
    writeResult: (requestId: string, result: EmailReadEventResult) => void;
  },
  companyId: string,
  payload: EmailReadEventPayload,
): Promise<void> => {
  try {
    const email = loadEmailPayload(deps.repo, companyId);
    if (email === null) throw new Error(NOT_CONNECTED);
    const emails = await readRecentEmails(deps.emailDeps, email, payload.limit ?? 10);
    deps.writeResult(payload.requestId, { ok: true, emails });
  } catch (e) {
    deps.writeResult(payload.requestId, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
