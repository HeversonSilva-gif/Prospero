import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type {
  SmtpPayload,
  SmtpMessage,
  InboundEmail,
  SmtpSendFn,
  SmtpVerifyFn,
  ImapFetchFn,
} from "./email-client.js";

// Electron-side production transports for the email connector. Not unit-tested (they do
// real network I/O) — mirrors derivation's defaultRunProcess / the wrangler runner. The
// pure logic + the Resend HTTP path carry the test coverage in email-client.test.ts.

const transporter = (p: SmtpPayload): nodemailer.Transporter =>
  nodemailer.createTransport({
    host: p.smtpHost,
    port: p.smtpPort,
    secure: p.smtpSecure,
    auth: { user: p.smtpUser, pass: p.smtpPass },
  });

export const defaultSmtpSend: SmtpSendFn = async (p, m: SmtpMessage) => {
  // nodemailer's SentMessageInfo is loosely typed; assert the one field we read.
  const info = (await transporter(p).sendMail({
    from: p.from,
    to: m.to,
    subject: m.subject,
    text: m.text,
    ...(m.html !== undefined ? { html: m.html } : {}),
    ...(m.headers !== undefined ? { headers: m.headers } : {}),
  })) as { messageId: string };
  return { messageId: info.messageId };
};

export const defaultSmtpVerify: SmtpVerifyFn = async (p) => {
  await transporter(p).verify();
};

export const defaultImapFetch: ImapFetchFn = async (p, limit) => {
  const client = new ImapFlow({
    host: p.imapHost,
    port: p.imapPort,
    secure: true,
    auth: { user: p.smtpUser, pass: p.smtpPass },
    logger: false,
  });
  const out: InboundEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const total = typeof mailbox === "object" ? mailbox.exists : 0;
      if (total > 0) {
        const start = Math.max(1, total - limit + 1);
        for await (const msg of client.fetch(`${String(start)}:*`, { envelope: true })) {
          const env = msg.envelope;
          out.push({
            from: env?.from?.[0]?.address ?? "",
            subject: env?.subject ?? "",
            snippet: "",
            date: env?.date?.toISOString() ?? "",
            messageId: env?.messageId ?? "",
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return out.reverse();
};
